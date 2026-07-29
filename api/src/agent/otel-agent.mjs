#!/usr/bin/env node
// floci-cloud OTel PR agent.
// Clones a GitHub repo, finds code that talks to external systems (HTTP APIs,
// databases, caches, queues, cloud SDKs), asks a local Ollama model to add
// OpenTelemetry spans around those calls, then pushes a branch and opens a PR.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const REPO_URL = (process.env.REPO_URL ?? '').replace(/\.git$/, '');
const GITHUB_TOKEN = process.env.GITHUB_TOKEN ?? '';
const OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://localhost:11434';
const MODEL = process.env.MODEL || 'gemma3n:e4b';
const BASE_BRANCH = process.env.BASE_BRANCH || '';
const MAX_FILES = Math.min(Math.max(Number(process.env.MAX_FILES ?? 4) || 4, 1), 8);
const WORK = '/work';
const REPO_DIR = path.join(WORK, 'repo');

const log = (...parts) => console.log('[otel-agent]', ...parts);

function fail(message) {
  console.error('[otel-agent] FATAL:', message);
  process.exit(1);
}

const match = REPO_URL.match(/^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)$/);
if (!match) fail(`invalid REPO_URL: ${REPO_URL}`);
if (!GITHUB_TOKEN) fail('GITHUB_TOKEN is required');
const [, owner, repo] = match;

const AUTH_HEADER = `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${GITHUB_TOKEN}`).toString('base64')}`;

function git(args, opts = {}) {
  return execFileSync('git', args, {
    cwd: opts.cwd ?? REPO_DIR,
    env: { ...process.env, HOME: WORK, GIT_TERMINAL_PROMPT: '0' },
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  }).trim();
}

// ---- integration detection -------------------------------------------------
const LANGS = {
  '.js': 'JavaScript',
  '.mjs': 'JavaScript',
  '.cjs': 'JavaScript',
  '.ts': 'TypeScript',
  '.tsx': 'TypeScript',
  '.py': 'Python',
  '.go': 'Go',
  '.java': 'Java',
  '.rb': 'Ruby',
};

const PATTERNS = [
  ['HTTP client', /\bfetch\s*\(|axios|got\(|superagent|http\.request|https\.request|requests\.(get|post|put|delete|patch)|httpx|urllib|net\/http|http\.Get|http\.Post|http\.Client|HttpClient|RestTemplate|WebClient|OkHttp|Net::HTTP|Faraday/],
  ['SQL database', /\bpg\b|postgres|mysql2?|sqlite3?|mariadb|sequelize|typeorm|knex|prisma|psycopg2?|pymysql|sqlalchemy|database\/sql|sql\.Open|JdbcTemplate|DriverManager|ActiveRecord/i],
  ['NoSQL database', /mongodb|mongoose|pymongo|cassandra|couchdb|dynamodb|documentdb/i],
  ['Cache', /\bredis\b|ioredis|memcached|jedis|lettuce/i],
  ['Message queue', /kafkajs|kafka-python|confluent_kafka|amqplib|\bpika\b|rabbitmq|nats|pulsar|sqs|KafkaProducer|KafkaConsumer|JmsTemplate/i],
  ['Cloud SDK', /aws-sdk|@aws-sdk|boto3|google-cloud|@google-cloud|azure-|@azure\/|firebase/i],
  ['gRPC', /\bgrpc\b|grpc\.Dial|@grpc\/grpc-js/i],
  ['Email/SMS', /nodemailer|sendgrid|twilio|smtplib|mailgun/i],
  ['Payments', /stripe|paypal|braintree/i],
];

const SKIP_DIRS = new Set([
  '.git', 'node_modules', 'vendor', 'dist', 'build', 'out', 'target', '.next',
  '__pycache__', '.venv', 'venv', 'coverage', 'test', 'tests', '__tests__', 'spec',
]);

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      if (!SKIP_DIRS.has(entry) && !entry.startsWith('.')) yield* walk(full);
    } else if (stats.isFile() && stats.size > 0 && stats.size < 24 * 1024) {
      yield full;
    }
  }
}

function scanRepo() {
  const candidates = [];
  for (const file of walk(REPO_DIR)) {
    const ext = path.extname(file);
    if (!LANGS[ext]) continue;
    const base = path.basename(file).toLowerCase();
    if (/\.(test|spec|min)\.|_test\.go$/.test(base)) continue;
    const content = readFileSync(file, 'utf8');
    if (content.split('\n').length > 400) continue;
    if (/opentelemetry|@opentelemetry/i.test(content)) continue; // already instrumented
    const hits = [];
    let score = 0;
    for (const [label, re] of PATTERNS) {
      const found = content.match(new RegExp(re.source, `${re.flags.replace('g', '')}g`));
      if (found) {
        hits.push(label);
        score += found.length;
      }
    }
    if (hits.length > 0) {
      candidates.push({ file, rel: path.relative(REPO_DIR, file), lang: LANGS[ext], hits, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score || b.hits.length - a.hits.length);
  return candidates.slice(0, MAX_FILES);
}

// ---- ollama ----------------------------------------------------------------
function httpPostJson(url, payload) {
  // node:http with no timeout — undici's default headers timeout (300s) is too
  // short for CPU inference on multi-KB files.
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const request = http.request(
      url,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
      },
      (response) => {
        let data = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => (data += chunk));
        response.on('end', () => {
          if ((response.statusCode ?? 500) >= 400) {
            reject(new Error(`ollama ${response.statusCode}: ${data.slice(0, 300)}`));
          } else {
            try {
              resolve(JSON.parse(data));
            } catch {
              reject(new Error(`ollama returned invalid JSON: ${data.slice(0, 200)}`));
            }
          }
        });
      },
    );
    request.setTimeout(0);
    request.on('error', reject);
    request.end(body);
  });
}

async function ollama(body) {
  const endpoint = `${OLLAMA_URL}${body.name ? '/api/pull' : '/api/chat'}`;
  const payload = { ...body, stream: false };
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await httpPostJson(endpoint, payload);
    } catch (error) {
      lastError = error;
      // If the ollama pod was restarted/evicted mid-run its ephemeral model
      // volume is gone — re-pull before the next chat attempt.
      if (!body.name && /not found/i.test(error.message ?? '')) {
        log(`  model missing on server (pod likely restarted) — re-pulling ${MODEL}…`);
        try {
          await httpPostJson(`${OLLAMA_URL}/api/pull`, { name: MODEL, stream: false });
          log('  re-pull complete');
        } catch (pullError) {
          log(`  re-pull failed: ${pullError.message ?? pullError}`);
        }
      }
      log(`  ollama attempt ${attempt}/3 failed: ${error.message ?? error} — retrying in ${attempt * 20}s`);
      await new Promise((resolveWait) => setTimeout(resolveWait, attempt * 20000));
    }
  }
  throw lastError;
}

async function ensureModel() {
  log(`ensuring model ${MODEL} is available (may download several GB)…`);
  const started = Date.now();
  const result = await ollama({ name: MODEL });
  log(`model ready (${result.status ?? 'ok'}) in ${Math.round((Date.now() - started) / 1000)}s`);
}

const OTEL_EXAMPLES = {
  JavaScript: `import { trace, SpanStatusCode } from '@opentelemetry/api';\nconst tracer = trace.getTracer('app');\n// wrap (note the RETURN): return await tracer.startActiveSpan('db.query', async (span) => { try { const r = await pool.query(sql); span.end(); return r; } catch (e) { span.recordException(e); span.setStatus({ code: SpanStatusCode.ERROR }); span.end(); throw e; } });`,
  TypeScript: `import { trace, SpanStatusCode } from '@opentelemetry/api';\nconst tracer = trace.getTracer('app');\n// wrap (note the RETURN): return await tracer.startActiveSpan('http.request', async (span) => { try { const r = await client.get(url); span.end(); return r; } catch (e) { span.recordException(e); span.setStatus({ code: SpanStatusCode.ERROR }); span.end(); throw e; } });`,
  Python: `from opentelemetry import trace\ntracer = trace.get_tracer(__name__)\n# wrap: with tracer.start_as_current_span("db.query") as span: ...  (use span.record_exception(e) in except blocks)`,
  Go: `import ("go.opentelemetry.io/otel"; "go.opentelemetry.io/otel/codes")\nvar tracer = otel.Tracer("app")\n// wrap: ctx, span := tracer.Start(ctx, "http.request"); defer span.End(); on error: span.RecordError(err); span.SetStatus(codes.Error, err.Error())`,
  Java: `import io.opentelemetry.api.GlobalOpenTelemetry;\nTracer tracer = GlobalOpenTelemetry.getTracer("app");\n// wrap: Span span = tracer.spanBuilder("db.query").startSpan(); try (Scope s = span.makeCurrent()) { ... } catch (Exception e) { span.recordException(e); throw e; } finally { span.end(); }`,
  Ruby: `require 'opentelemetry/sdk'\nTRACER = OpenTelemetry.tracer_provider.tracer('app')\n# wrap: TRACER.in_span('db.query') do |span| ... end  (span.record_exception(e) on rescue)`,
};

const SYSTEM_PROMPT = [
  'You add OpenTelemetry instrumentation to source code.',
  'Focus ONLY on calls to external systems: HTTP/API requests, databases, caches, message queues, cloud SDKs, gRPC.',
  'Use ONLY the official OpenTelemetry API exactly as shown in the reference snippet provided — never invent package names, import paths, or methods.',
  'Keep ALL existing imports and add the OpenTelemetry import alongside them.',
  'Wrap each external call in a span with a descriptive name, record errors on the span, and do not change any business logic, function signatures, or existing behavior.',
  'Use normal spaces for indentation.',
  'Reply with the COMPLETE modified file inside ONE fenced code block and nothing else — no explanations, no extra example blocks, no setup files.',
].join(' ');

function sanitizeCode(code) {
  // Small local models sometimes emit SentencePiece underscore glyphs (▁) for
  // leading spaces and non-breaking spaces — normalize them back.
  return code.replace(/▁/g, ' ').replace(/\u00a0/g, ' ');
}

function importsPreserved(original, code) {
  const importRe = /^\s*(?:import\s.+|from\s+\S+\s+import\s.+|const\s+\w+\s*=\s*require\(.+)$/gm;
  const names = new Set();
  for (const line of original.match(importRe) ?? []) {
    for (const name of line.match(/['"]([^'"]+)['"]/g) ?? []) {
      names.add(name.slice(1, -1));
    }
  }
  for (const name of names) {
    if (!code.includes(name)) {
      return name;
    }
  }
  return null;
}

async function requestInstrumentation(candidate, original, strict) {
  const example = OTEL_EXAMPLES[candidate.lang];
  const reminder = strict
    ? '\n\nIMPORTANT: your previous attempt was rejected. Keep every original import line untouched, use only @opentelemetry/api-style official packages from the reference, and output the whole file.'
    : '';
  const result = await ollama({
    model: MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Language: ${candidate.lang}\nFile: ${candidate.rel}\nExternal integrations detected: ${candidate.hits.join(', ')}\n\nOfficial OpenTelemetry reference for ${candidate.lang}:\n\`\`\`\n${example ?? ''}\n\`\`\`\n\nFile to instrument:\n\`\`\`\n${original}\n\`\`\`${reminder}`,
      },
    ],
    options: { temperature: 0.1, num_ctx: 6144 },
  });
  const reply = result.message?.content ?? '';
  // Pick the LARGEST fenced block — small files often make the model emit
  // extra example/snippet blocks alongside the rewritten file.
  const fences = [...reply.matchAll(/```[a-zA-Z0-9]*\n([\s\S]*?)```/g)].map((m) => m[1]);
  return sanitizeCode(fences.sort((a, b) => b.length - a.length)[0] ?? '');
}

function validateCode(original, code) {
  if (!code || code.length < original.length * 0.5) {
    return 'output too short or missing code block';
  }
  if (!/opentelemetry|otel|tracer|span/i.test(code)) {
    return 'no OpenTelemetry usage in output';
  }
  const missing = importsPreserved(original, code);
  if (missing) {
    return `dropped original import "${missing}"`;
  }
  if (/[▁\u00a0]/.test(code)) {
    return 'contains invalid whitespace glyphs';
  }
  // OTel adds a large fixed overhead (imports, tracer setup, span wrappers) that
  // dominates small files — allow generous growth there, tighter on big files.
  const originalLines = original.split('\n').length;
  if (code.split('\n').length > Math.max(originalLines * 3, originalLines + 120)) {
    return 'output suspiciously large';
  }
  return null;
}

async function instrumentFile(candidate) {
  const original = readFileSync(candidate.file, 'utf8');
  log(`instrumenting ${candidate.rel} [${candidate.lang}] — integrations: ${candidate.hits.join(', ')}`);
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const started = Date.now();
    const code = await requestInstrumentation(candidate, original, attempt > 1);
    const seconds = Math.round((Date.now() - started) / 1000);
    const problem = validateCode(original, code);
    if (!problem) {
      writeFileSync(candidate.file, code.endsWith('\n') ? code : `${code}\n`);
      log(`  ✓ instrumented in ${seconds}s (attempt ${attempt})`);
      return true;
    }
    log(`  ✗ attempt ${attempt}/2 rejected (${seconds}s): ${problem}`);
  }
  return false;
}

// ---- docs + PR -------------------------------------------------------------
const DEPS = {
  JavaScript: '`npm install @opentelemetry/api @opentelemetry/sdk-node @opentelemetry/auto-instrumentations-node`',
  TypeScript: '`npm install @opentelemetry/api @opentelemetry/sdk-node @opentelemetry/auto-instrumentations-node`',
  Python: '`pip install opentelemetry-api opentelemetry-sdk opentelemetry-exporter-otlp`',
  Go: '`go get go.opentelemetry.io/otel go.opentelemetry.io/otel/sdk go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp`',
  Java: 'add `io.opentelemetry:opentelemetry-api` and `io.opentelemetry:opentelemetry-sdk` to your build',
  Ruby: '`gem install opentelemetry-sdk opentelemetry-exporter-otlp`',
};

function writeDocs(changed) {
  const languages = [...new Set(changed.map((c) => c.lang))];
  const lines = [
    '# OpenTelemetry instrumentation',
    '',
    'This change adds OpenTelemetry spans around calls to external systems',
    '(HTTP APIs, databases, caches, message queues and cloud SDKs).',
    '',
    '## Files instrumented',
    '',
    ...changed.map((c) => `- \`${c.rel}\` — ${c.hits.join(', ')}`),
    '',
    '## Dependencies',
    '',
    ...languages.map((lang) => `- **${lang}**: ${DEPS[lang] ?? 'add the OpenTelemetry SDK for your runtime'}`),
    '',
    '## Exporting traces',
    '',
    'Point the OTLP exporter at your collector:',
    '',
    '```bash',
    'export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318',
    'export OTEL_SERVICE_NAME=' + repo,
    '```',
    '',
    `_Generated by the floci-cloud OTel agent using \`${MODEL}\` via Ollama._`,
    '',
  ];
  writeFileSync(path.join(REPO_DIR, 'OTEL_INSTRUMENTATION.md'), lines.join('\n'));
}

async function openPullRequest(branch, base, changed) {
  const body = [
    'This PR adds OpenTelemetry instrumentation focused on integrations with external systems.',
    '',
    '## Instrumented files',
    '',
    ...changed.map((c) => `- \`${c.rel}\` — ${c.hits.join(', ')}`),
    '',
    'See `OTEL_INSTRUMENTATION.md` for dependency and exporter setup.',
    '',
    `> Generated automatically by the floci-cloud OTel agent (model \`${MODEL}\` on Ollama).`,
    '> Review carefully before merging — LLM-generated instrumentation should be validated.',
  ].join('\n');
  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${GITHUB_TOKEN}`,
      accept: 'application/vnd.github+json',
      'content-type': 'application/json',
      'user-agent': 'floci-otel-agent',
    },
    body: JSON.stringify({
      title: 'Add OpenTelemetry instrumentation for external integrations',
      head: branch,
      base,
      body,
      maintainer_can_modify: true,
    }),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`GitHub PR creation failed (${response.status}): ${JSON.stringify(payload).slice(0, 400)}`);
  }
  return payload.html_url;
}

// ---- main ------------------------------------------------------------------
async function main() {
  log(`repo=${owner}/${repo} model=${MODEL} maxFiles=${MAX_FILES}`);
  await ensureModel();

  log('cloning repository…');
  git(['clone', '--depth', '50', '-c', `http.https://github.com/.extraheader=${AUTH_HEADER}`, `${REPO_URL}.git`, REPO_DIR], { cwd: WORK });
  git(['config', 'http.https://github.com/.extraheader', AUTH_HEADER]);
  git(['config', 'user.name', 'floci-otel-agent']);
  git(['config', 'user.email', 'otel-agent@floci.cloud']);
  const base = BASE_BRANCH || git(['rev-parse', '--abbrev-ref', 'HEAD']);
  if (BASE_BRANCH) git(['checkout', BASE_BRANCH]);
  log(`base branch: ${base}`);

  const candidates = scanRepo();
  if (candidates.length === 0) {
    log('no files with external integrations found — nothing to do.');
    log('RESULT: no-changes');
    return;
  }
  log(`selected ${candidates.length} file(s): ${candidates.map((c) => c.rel).join(', ')}`);

  const changed = [];
  for (const candidate of candidates) {
    try {
      if (await instrumentFile(candidate)) changed.push(candidate);
    } catch (err) {
      log(`  ✗ error on ${candidate.rel}: ${err.message}`);
    }
  }
  if (changed.length === 0) {
    log('model produced no usable instrumentation — nothing to commit.');
    log('RESULT: no-changes');
    return;
  }

  writeDocs(changed);
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
  const branch = `floci/otel-instrumentation-${stamp}`;
  git(['checkout', '-b', branch]);
  git(['add', '-A']);
  git(['commit', '-m', 'Add OpenTelemetry instrumentation for external integrations']);
  log(`pushing ${branch}…`);
  git(['push', 'origin', branch]);

  const prUrl = await openPullRequest(branch, base, changed);
  log(`pull request created: ${prUrl}`);
  log(`PR_URL: ${prUrl}`);
  log('RESULT: success');
}

main().catch((err) => fail(err.stack ?? String(err)));
