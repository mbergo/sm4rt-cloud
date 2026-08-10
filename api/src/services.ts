export const REAL_SERVICES = [
  'kafka',
  'pulsar',
  'activemq',
  'zookeeper',
  'cassandra',
  'couchdb',
  'ozone',
  'flink',
  'solr',
  'nifi',
  'tomcat',
  'httpd',
  'ollama',
  'jupyter',
  'mlflow',
  'iceberg',
  'trino',
  'airflow',
  'spark',
  'atlas',
  'polaris',
  'lgtm',
] as const;
export type RealServiceId = (typeof REAL_SERVICES)[number];

export const SERVICE_CATEGORIES = [
  'messaging',
  'data',
  'analytics',
  'pipelines',
  'web',
  'ai',
  'observability',
] as const;
export type ServiceCategory = (typeof SERVICE_CATEGORIES)[number];

export function isRealServiceId(value: string): value is RealServiceId {
  return (REAL_SERVICES as readonly string[]).includes(value);
}

export type RealServiceStatus = 'stopped' | 'starting' | 'running' | 'error';

export interface ServiceEndpoint {
  label: string;
  value: string;
}

export interface RealServiceInfo {
  id: RealServiceId;
  label: string;
  description: string;
  image: string;
  category: ServiceCategory;
  status: RealServiceStatus;
  statusDetail: string | null;
  endpoints: ServiceEndpoint[];
}

interface EndpointContext {
  serviceHost: string;
  externalUrl: string | null;
}

export interface ServiceSidecar {
  name: string;
  /** defaults to the main image */
  image?: string;
  command?: string[];
  args?: string[];
  env?: { name: string; value: string }[];
  resources: {
    requests: { cpu: string; memory: string };
    limits: { cpu: string; memory: string };
  };
}

export interface RealServiceSpec {
  id: RealServiceId;
  label: string;
  description: string;
  image: string;
  category: ServiceCategory;
  command?: string[];
  args?: string[];
  ports: { name: string; port: number }[];
  probePort: number;
  /** generous ceiling for slow-starting JVMs (readiness failureThreshold * period) */
  startupSeconds: number;
  env: (ctx: { serviceHost: string; externalHost: string }) => { name: string; value: string }[];
  resources: {
    requests: { cpu: string; memory: string };
    limits: { cpu: string; memory: string };
  };
  /** extra containers running in the same pod (e.g. flink taskmanager) */
  sidecars?: ServiceSidecar[];
  /** emptyDir scratch volumes mounted on the main container */
  volumes?: { name: string; mountPath: string; sizeLimit?: string }[];
  /** when set, an Ingress is created exposing this HTTP port externally */
  httpIngressPort?: number;
  /** set to HTTPS when the backend serves TLS (e.g. NiFi 2.x) */
  ingressBackendProtocol?: 'HTTPS';
  endpoints: (ctx: EndpointContext) => ServiceEndpoint[];
}

export const SERVICE_CATALOG: Record<RealServiceId, RealServiceSpec> = {
  kafka: {
    id: 'kafka',
    label: 'Kafka',
    description: 'Apache Kafka 4.3 broker (KRaft, single node).',
    image: 'apache/kafka:4.3.1',
    category: 'messaging',
    ports: [{ name: 'broker', port: 9092 }],
    probePort: 9092,
    startupSeconds: 180,
    env: ({ serviceHost }) => [
      { name: 'KAFKA_NODE_ID', value: '1' },
      { name: 'KAFKA_PROCESS_ROLES', value: 'broker,controller' },
      { name: 'KAFKA_LISTENERS', value: 'PLAINTEXT://:9092,CONTROLLER://:9093' },
      { name: 'KAFKA_ADVERTISED_LISTENERS', value: `PLAINTEXT://${serviceHost}:9092` },
      { name: 'KAFKA_CONTROLLER_LISTENER_NAMES', value: 'CONTROLLER' },
      {
        name: 'KAFKA_LISTENER_SECURITY_PROTOCOL_MAP',
        value: 'CONTROLLER:PLAINTEXT,PLAINTEXT:PLAINTEXT',
      },
      { name: 'KAFKA_CONTROLLER_QUORUM_VOTERS', value: '1@localhost:9093' },
      { name: 'KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR', value: '1' },
      { name: 'KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR', value: '1' },
      { name: 'KAFKA_TRANSACTION_STATE_LOG_MIN_ISR', value: '1' },
      { name: 'KAFKA_GROUP_INITIAL_REBALANCE_DELAY_MS', value: '0' },
      { name: 'KAFKA_LOG_DIRS', value: '/tmp/kraft-combined-logs' },
      { name: 'KAFKA_HEAP_OPTS', value: '-Xmx512m -Xms256m' },
    ],
    resources: {
      requests: { cpu: '100m', memory: '512Mi' },
      limits: { cpu: '1', memory: '1Gi' },
    },
    endpoints: ({ serviceHost }) => [
      { label: 'Bootstrap servers', value: `${serviceHost}:9092` },
    ],
  },
  cassandra: {
    id: 'cassandra',
    label: 'Cassandra',
    description: 'Apache Cassandra 5.0 single-node cluster.',
    image: 'cassandra:5.0',
    category: 'data',
    ports: [{ name: 'cql', port: 9042 }],
    probePort: 9042,
    startupSeconds: 300,
    env: () => [
      { name: 'CASSANDRA_CLUSTER_NAME', value: 'floci' },
      { name: 'MAX_HEAP_SIZE', value: '768M' },
      { name: 'HEAP_NEWSIZE', value: '200M' },
    ],
    resources: {
      requests: { cpu: '250m', memory: '1Gi' },
      limits: { cpu: '1', memory: '2Gi' },
    },
    endpoints: ({ serviceHost }) => [
      { label: 'CQL contact point', value: `${serviceHost}:9042` },
      { label: 'cqlsh', value: `cqlsh ${serviceHost} 9042` },
    ],
  },
  activemq: {
    id: 'activemq',
    label: 'ActiveMQ',
    description: 'Apache ActiveMQ Classic 6.2 message broker.',
    image: 'apache/activemq-classic:6.2.0',
    category: 'messaging',
    ports: [
      { name: 'openwire', port: 61616 },
      { name: 'amqp', port: 5672 },
      { name: 'stomp', port: 61613 },
      { name: 'mqtt', port: 1883 },
      { name: 'web', port: 8161 },
    ],
    probePort: 61616,
    startupSeconds: 120,
    env: () => [],
    resources: {
      requests: { cpu: '50m', memory: '256Mi' },
      limits: { cpu: '500m', memory: '768Mi' },
    },
    endpoints: ({ serviceHost }) => [
      { label: 'OpenWire', value: `tcp://${serviceHost}:61616` },
      { label: 'AMQP', value: `amqp://${serviceHost}:5672` },
      { label: 'Web console (admin/admin)', value: `http://${serviceHost}:8161` },
    ],
  },
  ozone: {
    id: 'ozone',
    label: 'Ozone S3',
    description: 'Apache Ozone 2.2 object store with S3-compatible gateway.',
    image: 'apache/ozone:2.2.0-all-in-one',
    category: 'data',
    // image's env->conf hook is broken (root-owned ozone-site.xml); copy config
    // to a writable dir and force client replication=1 for single-node writes
    command: [
      '/usr/local/bin/dumb-init',
      '--',
      '/bin/bash',
      '-c',
      'mkdir -p /tmp/ozone-conf && cp /etc/hadoop/* /tmp/ozone-conf/ && sed -i "s#</configuration>#  <property><name>ozone.replication</name><value>1</value></property>\\n</configuration>#" /tmp/ozone-conf/ozone-site.xml && export OZONE_CONF_DIR=/tmp/ozone-conf HADOOP_CONF_DIR=/tmp/ozone-conf && exec /usr/local/bin/start-all-services.sh',
    ],
    ports: [{ name: 's3g', port: 9878 }],
    probePort: 9878,
    startupSeconds: 300,
    env: () => [],
    resources: {
      requests: { cpu: '250m', memory: '1Gi' },
      limits: { cpu: '1', memory: '2Gi' },
    },
    httpIngressPort: 9878,
    endpoints: ({ serviceHost, externalUrl }) => [
      { label: 'S3 endpoint (in-cluster)', value: `http://${serviceHost}:9878` },
      ...(externalUrl ? [{ label: 'S3 endpoint (public)', value: externalUrl }] : []),
      ...(externalUrl
        ? [{ label: 'AWS CLI', value: `aws s3 ls --endpoint-url ${externalUrl}` }]
        : []),
    ],
  },
  pulsar: {
    id: 'pulsar',
    label: 'Pulsar',
    description: 'Apache Pulsar 4.0 LTS standalone broker with admin REST API.',
    image: 'apachepulsar/pulsar:4.0.12',
    category: 'messaging',
    command: ['bin/pulsar', 'standalone'],
    ports: [
      { name: 'broker', port: 6650 },
      { name: 'admin', port: 8080 },
    ],
    probePort: 8080,
    startupSeconds: 240,
    env: () => [{ name: 'PULSAR_MEM', value: '-Xms512m -Xmx768m' }],
    resources: {
      requests: { cpu: '250m', memory: '768Mi' },
      limits: { cpu: '1', memory: '1536Mi' },
    },
    volumes: [{ name: 'data', mountPath: '/pulsar/data' }],
    httpIngressPort: 8080,
    endpoints: ({ serviceHost, externalUrl }) => [
      { label: 'Broker', value: `pulsar://${serviceHost}:6650` },
      { label: 'Admin REST (in-cluster)', value: `http://${serviceHost}:8080` },
      ...(externalUrl ? [{ label: 'Admin REST (public)', value: externalUrl }] : []),
    ],
  },
  zookeeper: {
    id: 'zookeeper',
    label: 'ZooKeeper',
    description: 'Apache ZooKeeper 3.9 standalone coordination service.',
    image: 'zookeeper:3.9.5',
    category: 'messaging',
    ports: [{ name: 'client', port: 2181 }],
    probePort: 2181,
    startupSeconds: 60,
    env: () => [
      { name: 'ZOO_4LW_COMMANDS_WHITELIST', value: 'srvr,ruok,stat' },
      { name: 'JVMFLAGS', value: '-Xmx256m' },
    ],
    resources: {
      requests: { cpu: '50m', memory: '192Mi' },
      limits: { cpu: '500m', memory: '512Mi' },
    },
    endpoints: ({ serviceHost }) => [
      { label: 'Client connect', value: `${serviceHost}:2181` },
      { label: 'zkCli', value: `zkCli.sh -server ${serviceHost}:2181` },
    ],
  },
  couchdb: {
    id: 'couchdb',
    label: 'CouchDB',
    description: 'Apache CouchDB 3.5 document database with Fauxton UI.',
    image: 'couchdb:3.5.2',
    category: 'data',
    ports: [{ name: 'http', port: 5984 }],
    probePort: 5984,
    startupSeconds: 90,
    env: () => [
      { name: 'COUCHDB_USER', value: 'admin' },
      { name: 'COUCHDB_PASSWORD', value: 'floci' },
    ],
    resources: {
      requests: { cpu: '50m', memory: '256Mi' },
      limits: { cpu: '500m', memory: '768Mi' },
    },
    httpIngressPort: 5984,
    endpoints: ({ serviceHost, externalUrl }) => [
      { label: 'HTTP API (admin/floci)', value: `http://${serviceHost}:5984` },
      { label: 'Fauxton UI (in-cluster)', value: `http://${serviceHost}:5984/_utils` },
      ...(externalUrl ? [{ label: 'Fauxton UI (public)', value: `${externalUrl}/_utils` }] : []),
    ],
  },
  flink: {
    id: 'flink',
    label: 'Flink',
    description: 'Apache Flink 2.3 mini cluster (JobManager + TaskManager) with web UI.',
    image: 'flink:2.3.0-scala_2.12-java21',
    category: 'analytics',
    args: ['jobmanager'],
    ports: [
      { name: 'ui', port: 8081 },
      { name: 'rpc', port: 6123 },
    ],
    probePort: 8081,
    startupSeconds: 150,
    env: () => [
      {
        name: 'FLINK_PROPERTIES',
        value: 'jobmanager.rpc.address: localhost\njobmanager.memory.process.size: 768m',
      },
    ],
    resources: {
      requests: { cpu: '250m', memory: '768Mi' },
      limits: { cpu: '500m', memory: '1Gi' },
    },
    sidecars: [
      {
        name: 'taskmanager',
        args: ['taskmanager'],
        env: [
          {
            name: 'FLINK_PROPERTIES',
            value:
              'jobmanager.rpc.address: localhost\ntaskmanager.numberOfTaskSlots: 2\ntaskmanager.memory.process.size: 1024m',
          },
        ],
        resources: {
          requests: { cpu: '250m', memory: '1Gi' },
          limits: { cpu: '1', memory: '1536Mi' },
        },
      },
    ],
    httpIngressPort: 8081,
    endpoints: ({ serviceHost, externalUrl }) => [
      { label: 'Web UI (in-cluster)', value: `http://${serviceHost}:8081` },
      ...(externalUrl ? [{ label: 'Web UI (public)', value: externalUrl }] : []),
      { label: 'JobManager RPC', value: `${serviceHost}:6123` },
    ],
  },
  solr: {
    id: 'solr',
    label: 'Solr',
    description: 'Apache Solr 9.10 search platform with admin UI.',
    image: 'solr:9.10.1',
    category: 'analytics',
    ports: [{ name: 'http', port: 8983 }],
    probePort: 8983,
    startupSeconds: 90,
    env: () => [{ name: 'SOLR_HEAP', value: '512m' }],
    resources: {
      requests: { cpu: '100m', memory: '512Mi' },
      limits: { cpu: '1', memory: '1Gi' },
    },
    httpIngressPort: 8983,
    endpoints: ({ serviceHost, externalUrl }) => [
      { label: 'Admin UI (in-cluster)', value: `http://${serviceHost}:8983/solr` },
      ...(externalUrl ? [{ label: 'Admin UI (public)', value: `${externalUrl}/solr` }] : []),
      { label: 'Create core', value: `solr create_core -c demo -url http://${serviceHost}:8983` },
    ],
  },
  nifi: {
    id: 'nifi',
    label: 'NiFi',
    description: 'Apache NiFi 2.10 dataflow automation.',
    image: 'apache/nifi:2.10.0',
    category: 'web',
    // NiFi 2.x images force HTTPS; rewrite properties for plain HTTP behind the gateway
    command: [
      'bash',
      '-c',
      'sed -i -e "s|^nifi.web.https.port=.*|nifi.web.https.port=|" -e "s|^nifi.web.https.host=.*|nifi.web.https.host=|" -e "s|^nifi.web.http.port=.*|nifi.web.http.port=8080|" -e "s|^nifi.web.http.host=.*|nifi.web.http.host=0.0.0.0|" -e "s|^nifi.remote.input.secure=.*|nifi.remote.input.secure=false|" -e "s|^nifi.security.keystore=.*|nifi.security.keystore=|" -e "s|^nifi.security.truststore=.*|nifi.security.truststore=|" conf/nifi.properties && exec bin/nifi.sh run',
    ],
    ports: [{ name: 'http', port: 8080 }],
    probePort: 8080,
    startupSeconds: 300,
    env: ({ externalHost }) => [
      { name: 'NIFI_WEB_PROXY_HOST', value: `${externalHost},${externalHost}:443` },
    ],
    resources: {
      requests: { cpu: '250m', memory: '1Gi' },
      limits: { cpu: '1', memory: '2Gi' },
    },
    httpIngressPort: 8080,
    endpoints: ({ serviceHost, externalUrl }) => [
      { label: 'NiFi UI (in-cluster)', value: `http://${serviceHost}:8080/nifi` },
      ...(externalUrl ? [{ label: 'NiFi UI (public)', value: `${externalUrl}/nifi` }] : []),
    ],
  },
  tomcat: {
    id: 'tomcat',
    label: 'Tomcat',
    description: 'Apache Tomcat 11 servlet container with default webapps.',
    image: 'tomcat:11.0.24-jre21',
    category: 'web',
    command: [
      'sh',
      '-c',
      'cp -rn /usr/local/tomcat/webapps.dist/* /usr/local/tomcat/webapps/ 2>/dev/null || true; exec catalina.sh run',
    ],
    ports: [{ name: 'http', port: 8080 }],
    probePort: 8080,
    startupSeconds: 60,
    env: () => [],
    resources: {
      requests: { cpu: '50m', memory: '256Mi' },
      limits: { cpu: '500m', memory: '768Mi' },
    },
    httpIngressPort: 8080,
    endpoints: ({ serviceHost, externalUrl }) => [
      { label: 'HTTP (in-cluster)', value: `http://${serviceHost}:8080` },
      ...(externalUrl ? [{ label: 'HTTP (public)', value: externalUrl }] : []),
    ],
  },
  httpd: {
    id: 'httpd',
    label: 'HTTPD',
    description: 'Apache HTTP Server 2.4 web server.',
    image: 'httpd:2.4.68',
    category: 'web',
    ports: [{ name: 'http', port: 80 }],
    probePort: 80,
    startupSeconds: 30,
    env: () => [],
    resources: {
      requests: { cpu: '25m', memory: '64Mi' },
      limits: { cpu: '250m', memory: '256Mi' },
    },
    httpIngressPort: 80,
    endpoints: ({ serviceHost, externalUrl }) => [
      { label: 'HTTP (in-cluster)', value: `http://${serviceHost}:80` },
      ...(externalUrl ? [{ label: 'HTTP (public)', value: externalUrl }] : []),
    ],
  },
  ollama: {
    id: 'ollama',
    label: 'Ollama',
    description: 'Local LLM runtime — Bedrock-style model API. Powers the OTel PR agent (gemma3n:e4b).',
    image: 'ollama/ollama:0.32.5',
    category: 'ai',
    ports: [{ name: 'api', port: 11434 }],
    probePort: 11434,
    startupSeconds: 90,
    env: () => [{ name: 'OLLAMA_KEEP_ALIVE', value: '5m' }],
    resources: {
      requests: { cpu: '500m', memory: '2Gi' },
      limits: { cpu: '3', memory: '12Gi' },
    },
    volumes: [{ name: 'models', mountPath: '/root/.ollama', sizeLimit: '12Gi' }],
    httpIngressPort: 11434,
    endpoints: ({ serviceHost, externalUrl }) => [
      { label: 'API (in-cluster)', value: `http://${serviceHost}:11434` },
      ...(externalUrl ? [{ label: 'API (public)', value: externalUrl }] : []),
      ...(externalUrl
        ? [
            {
              label: 'Pull a model',
              value: `curl ${externalUrl}/api/pull -d '{"name":"gemma3n:e4b"}'`,
            },
            {
              label: 'Generate',
              value: `curl ${externalUrl}/api/generate -d '{"model":"gemma3n:e4b","prompt":"Hello"}'`,
            },
          ]
        : []),
    ],
  },
  jupyter: {
    id: 'jupyter',
    label: 'PySpark Notebook',
    description: 'Jupyter Lab + PySpark — SageMaker/Databricks-style notebooks.',
    image: 'quay.io/jupyter/pyspark-notebook:spark-4.2.0',
    category: 'ai',
    ports: [{ name: 'http', port: 8888 }],
    probePort: 8888,
    startupSeconds: 90,
    env: () => [{ name: 'JUPYTER_TOKEN', value: 'floci' }],
    resources: {
      requests: { cpu: '250m', memory: '1Gi' },
      limits: { cpu: '2', memory: '3Gi' },
    },
    volumes: [{ name: 'work', mountPath: '/home/jovyan/work' }],
    httpIngressPort: 8888,
    endpoints: ({ serviceHost, externalUrl }) => [
      { label: 'Jupyter Lab (in-cluster)', value: `http://${serviceHost}:8888` },
      ...(externalUrl ? [{ label: 'Jupyter Lab (public)', value: `${externalUrl}/lab?token=floci` }] : []),
      { label: 'Token', value: 'floci' },
    ],
  },
  mlflow: {
    id: 'mlflow',
    label: 'MLflow',
    description: 'MLflow 3 tracking server & model registry (SageMaker-style experiments).',
    image: 'ghcr.io/mlflow/mlflow:v3.14.0',
    category: 'ai',
    command: [
      'mlflow',
      'server',
      '--host',
      '0.0.0.0',
      '--port',
      '5000',
      '--workers',
      '1',
      '--allowed-hosts',
      '*',
      '--cors-allowed-origins',
      '*',
      '--backend-store-uri',
      'sqlite:////mlflow/mlflow.db',
      '--artifacts-destination',
      '/mlflow/artifacts',
      '--serve-artifacts',
    ],
    ports: [{ name: 'http', port: 5000 }],
    probePort: 5000,
    startupSeconds: 90,
    env: () => [{ name: 'MLFLOW_SERVER_ENABLE_JOB_EXECUTION', value: 'false' }],
    resources: {
      requests: { cpu: '100m', memory: '512Mi' },
      limits: { cpu: '1', memory: '1536Mi' },
    },
    volumes: [{ name: 'store', mountPath: '/mlflow' }],
    httpIngressPort: 5000,
    endpoints: ({ serviceHost, externalUrl }) => [
      { label: 'Tracking UI (in-cluster)', value: `http://${serviceHost}:5000` },
      ...(externalUrl ? [{ label: 'Tracking UI (public)', value: externalUrl }] : []),
      ...(externalUrl ? [{ label: 'MLFLOW_TRACKING_URI', value: externalUrl }] : []),
    ],
  },
  iceberg: {
    id: 'iceberg',
    label: 'Iceberg Catalog',
    description: 'Apache Iceberg REST catalog backed by Ozone S3 (Glue-style table catalog / cold storage).',
    image: 'apache/iceberg-rest-fixture:1.10.1',
    category: 'pipelines',
    ports: [{ name: 'http', port: 8181 }],
    probePort: 8181,
    startupSeconds: 90,
    env: ({ serviceHost }) => {
      const ozoneHost = serviceHost.replace('svc-iceberg', 'svc-ozone');
      return [
        { name: 'CATALOG_WAREHOUSE', value: 's3://iceberg/' },
        { name: 'CATALOG_IO__IMPL', value: 'org.apache.iceberg.aws.s3.S3FileIO' },
        { name: 'CATALOG_S3_ENDPOINT', value: `http://${ozoneHost}:9878` },
        { name: 'CATALOG_S3_PATH__STYLE__ACCESS', value: 'true' },
        { name: 'AWS_ACCESS_KEY_ID', value: 'floci' },
        { name: 'AWS_SECRET_ACCESS_KEY', value: 'floci-secret' },
        { name: 'AWS_REGION', value: 'us-east-1' },
      ];
    },
    resources: {
      requests: { cpu: '50m', memory: '256Mi' },
      limits: { cpu: '500m', memory: '768Mi' },
    },
    httpIngressPort: 8181,
    endpoints: ({ serviceHost, externalUrl }) => [
      { label: 'REST catalog (in-cluster)', value: `http://${serviceHost}:8181` },
      ...(externalUrl ? [{ label: 'REST catalog (public)', value: externalUrl }] : []),
      { label: 'Warehouse', value: 's3://iceberg/ (create the bucket in Ozone S3 first)' },
    ],
  },
  trino: {
    id: 'trino',
    label: 'Trino',
    description: 'Trino 483 SQL query engine (Athena-style) pre-wired to the Iceberg catalog.',
    image: 'trinodb/trino:483',
    category: 'pipelines',
    command: [
      '/bin/sh',
      '-c',
      [
        'mkdir -p /etc/trino/catalog 2>/dev/null || true',
        "grep -q process-forwarded /etc/trino/config.properties 2>/dev/null || echo 'http-server.process-forwarded=true' >> /etc/trino/config.properties || true",
        'cat > /etc/trino/catalog/iceberg.properties <<EOF || true',
        'connector.name=iceberg',
        'iceberg.catalog.type=rest',
        'iceberg.rest-catalog.uri=${ICEBERG_REST_URI}',
        'fs.native-s3.enabled=true',
        's3.endpoint=${OZONE_S3_ENDPOINT}',
        's3.region=us-east-1',
        's3.path-style-access=true',
        's3.aws-access-key=floci',
        's3.aws-secret-key=floci-secret',
        'EOF',
        'exec /usr/lib/trino/bin/run-trino',
      ].join('\n'),
    ],
    ports: [{ name: 'http', port: 8080 }],
    probePort: 8080,
    startupSeconds: 180,
    env: ({ serviceHost }) => {
      const ns = serviceHost.replace(/^svc-trino\./, '');
      return [
        { name: 'ICEBERG_REST_URI', value: `http://svc-iceberg.${ns}:8181` },
        { name: 'OZONE_S3_ENDPOINT', value: `http://svc-ozone.${ns}:9878` },
        { name: 'CATALOG_MANAGEMENT', value: 'static' },
      ];
    },
    resources: {
      requests: { cpu: '250m', memory: '1Gi' },
      limits: { cpu: '2', memory: '2Gi' },
    },
    httpIngressPort: 8080,
    endpoints: ({ serviceHost, externalUrl }) => [
      { label: 'Trino (in-cluster)', value: `http://${serviceHost}:8080` },
      ...(externalUrl ? [{ label: 'Web UI (public)', value: `${externalUrl}/ui/` }] : []),
      ...(externalUrl
        ? [{ label: 'CLI', value: `trino --server ${externalUrl} --user floci --catalog iceberg` }]
        : []),
      { label: 'Login', value: 'any username, no password' },
    ],
  },
  airflow: {
    id: 'airflow',
    label: 'Airflow',
    description: 'Apache Airflow 3.3 standalone (MWAA-style DAG orchestration).',
    image: 'apache/airflow:3.3.0',
    category: 'pipelines',
    args: ['standalone'],
    ports: [{ name: 'http', port: 8080 }],
    probePort: 8080,
    startupSeconds: 300,
    env: () => [
      { name: 'AIRFLOW__CORE__SIMPLE_AUTH_MANAGER_ALL_ADMINS', value: 'True' },
      { name: 'AIRFLOW__CORE__LOAD_EXAMPLES', value: 'True' },
    ],
    resources: {
      requests: { cpu: '250m', memory: '1Gi' },
      limits: { cpu: '1', memory: '2Gi' },
    },
    volumes: [{ name: 'airflow-home', mountPath: '/opt/airflow' }],
    httpIngressPort: 8080,
    endpoints: ({ serviceHost, externalUrl }) => [
      { label: 'Airflow UI (in-cluster)', value: `http://${serviceHost}:8080` },
      ...(externalUrl ? [{ label: 'Airflow UI (public)', value: externalUrl }] : []),
      { label: 'Login', value: 'not required (dev mode, all admins)' },
    ],
  },
  spark: {
    id: 'spark',
    label: 'Spark',
    description: 'Apache Spark 4.0 standalone cluster (master + worker) for large-scale data processing.',
    image: 'apache/spark:4.0.4',
    category: 'analytics',
    command: ['/opt/spark/bin/spark-class', 'org.apache.spark.deploy.master.Master'],
    ports: [
      { name: 'ui', port: 8080 },
      { name: 'rpc', port: 7077 },
    ],
    probePort: 8080,
    startupSeconds: 150,
    // SPARK_MASTER_HOST=localhost: swarm rewrites localhost -> service alias so
    // the master advertises the address workers dial; in k8s the worker sidecar
    // shares the pod, so localhost already matches (same pattern as flink's
    // jobmanager.rpc.address).
    env: () => [
      { name: 'SPARK_MASTER_HOST', value: 'localhost' },
      { name: 'SPARK_DAEMON_MEMORY', value: '512m' },
    ],
    resources: {
      requests: { cpu: '250m', memory: '768Mi' },
      limits: { cpu: '1', memory: '1536Mi' },
    },
    sidecars: [
      {
        name: 'worker',
        command: ['/bin/sh', '-c', 'exec /opt/spark/bin/spark-class org.apache.spark.deploy.worker.Worker "$SPARK_MASTER_URL"'],
        env: [
          { name: 'SPARK_MASTER_URL', value: 'spark://localhost:7077' },
          { name: 'SPARK_WORKER_CORES', value: '1' },
          { name: 'SPARK_WORKER_MEMORY', value: '1g' },
          { name: 'SPARK_WORKER_WEBUI_PORT', value: '8081' },
          { name: 'SPARK_DAEMON_MEMORY', value: '512m' },
        ],
        resources: {
          requests: { cpu: '250m', memory: '1Gi' },
          limits: { cpu: '1', memory: '2Gi' },
        },
      },
    ],
    httpIngressPort: 8080,
    endpoints: ({ serviceHost, externalUrl }) => [
      { label: 'Master UI (in-cluster)', value: `http://${serviceHost}:8080` },
      ...(externalUrl ? [{ label: 'Master UI (public)', value: externalUrl }] : []),
      { label: 'Master URL', value: `spark://${serviceHost}:7077` },
      { label: 'spark-submit', value: `spark-submit --master spark://${serviceHost}:7077 app.py` },
    ],
  },
  atlas: {
    id: 'atlas',
    label: 'Atlas',
    description:
      'Apache Atlas 2.3 metadata catalog & governance (lineage, classification). Embedded HBase + Solr — first start takes 5-8 min.',
    image: 'sburn/apache-atlas:2.3.0',
    category: 'pipelines',
    ports: [{ name: 'http', port: 21000 }],
    probePort: 21000,
    startupSeconds: 600,
    env: () => [],
    resources: {
      requests: { cpu: '500m', memory: '2Gi' },
      limits: { cpu: '1500m', memory: '3Gi' },
    },
    volumes: [{ name: 'data', mountPath: '/apache-atlas/data' }],
    httpIngressPort: 21000,
    endpoints: ({ serviceHost, externalUrl }) => [
      { label: 'Atlas UI (in-cluster)', value: `http://${serviceHost}:21000` },
      ...(externalUrl ? [{ label: 'Atlas UI (public)', value: externalUrl }] : []),
      { label: 'REST API', value: `http://${serviceHost}:21000/api/atlas/v2` },
      { label: 'Login', value: 'admin / admin' },
    ],
  },
  polaris: {
    id: 'polaris',
    label: 'Ariadne (Polaris)',
    description:
      'Ariadne — Apache Polaris 1.7 REST catalog for Iceberg tables (multi-catalog, credential vending).',
    image: 'apache/polaris:1.7.0',
    category: 'pipelines',
    ports: [
      { name: 'api', port: 8181 },
      { name: 'mgmt', port: 8182 },
    ],
    probePort: 8181,
    startupSeconds: 90,
    env: () => [
      { name: 'POLARIS_BOOTSTRAP_CREDENTIALS', value: 'POLARIS,root,secret' },
      { name: 'POLARIS_REALM_CONTEXT_REALMS', value: 'POLARIS' },
    ],
    resources: {
      requests: { cpu: '100m', memory: '512Mi' },
      limits: { cpu: '1', memory: '1Gi' },
    },
    httpIngressPort: 8181,
    endpoints: ({ serviceHost, externalUrl }) => [
      { label: 'Catalog API (in-cluster)', value: `http://${serviceHost}:8181/api/catalog` },
      ...(externalUrl ? [{ label: 'Catalog API (public)', value: `${externalUrl}/api/catalog` }] : []),
      { label: 'Management API', value: `http://${serviceHost}:8181/api/management/v1` },
      { label: 'OAuth token', value: `POST http://${serviceHost}:8181/api/catalog/v1/oauth/tokens (client root/secret, realm POLARIS)` },
    ],
  },
  lgtm: {
    id: 'lgtm',
    label: 'Monitoring (LGTM)',
    description: 'Grafana LGTM stack — Loki logs, Tempo traces, Mimir metrics + OTel collector (CloudWatch-style monitoring).',
    image: 'grafana/otel-lgtm:0.29.2',
    category: 'observability',
    ports: [
      { name: 'grafana', port: 3000 },
      { name: 'otlp-grpc', port: 4317 },
      { name: 'otlp-http', port: 4318 },
    ],
    probePort: 3000,
    startupSeconds: 180,
    env: () => [
      { name: 'GF_AUTH_ANONYMOUS_ENABLED', value: 'true' },
      { name: 'GF_AUTH_ANONYMOUS_ORG_ROLE', value: 'Admin' },
      { name: 'GF_SECURITY_ALLOW_EMBEDDING', value: 'true' },
      { name: 'ENABLE_LOGS_ALL', value: 'true' },
    ],
    resources: {
      requests: { cpu: '300m', memory: '1Gi' },
      limits: { cpu: '2', memory: '3Gi' },
    },
    volumes: [{ name: 'data', mountPath: '/data', sizeLimit: '4Gi' }],
    httpIngressPort: 3000,
    endpoints: ({ serviceHost, externalUrl }) => [
      ...(externalUrl ? [{ label: 'Grafana (public)', value: externalUrl }] : []),
      { label: 'Grafana (in-cluster)', value: `http://${serviceHost}:3000` },
      { label: 'OTLP gRPC (in-cluster)', value: `${serviceHost}:4317` },
      { label: 'OTLP HTTP (in-cluster)', value: `http://${serviceHost}:4318` },
      { label: 'Login', value: 'anonymous (admin)' },
    ],
  },
};
