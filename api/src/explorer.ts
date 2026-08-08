// Generated from floci ResolvedServiceCatalog — protocol table for the generic API Explorer.
export type ExplorerProto = 'JSON' | 'QUERY' | 'REST_JSON' | 'REST_XML' | 'CBOR';

export interface ExplorerService {
  id: string;
  proto: ExplorerProto;
  target: string | null;
  scope: string;
  sampleOp: string;
  sampleBody: string;
  /** AWS JSON protocol version — DynamoDB, SFN, CloudControl speak 1.0; everything else 1.1 */
  jsonVersion?: '1.0' | '1.1';
}

export const EXPLORER_SERVICES: ExplorerService[] = [
  { id: 'acm', proto: 'JSON', target: 'CertificateManager.', scope: 'acm', sampleOp: "ListCertificates", sampleBody: "{}" },
  { id: 'apigateway', proto: 'REST_JSON', target: null, scope: 'apigateway', sampleOp: "GET /restapis", sampleBody: "" },
  { id: 'apigatewayv2', proto: 'JSON', target: 'AmazonApiGatewayV2.', scope: 'apigatewayv2', sampleOp: "GET /v2/apis", sampleBody: "" },
  { id: 'appconfig', proto: 'REST_JSON', target: null, scope: 'appconfig', sampleOp: "GET /applications", sampleBody: "" },
  { id: 'appconfigdata', proto: 'REST_JSON', target: null, scope: 'appconfigdata', sampleOp: "GET /applications", sampleBody: "" },
  { id: 'appsync', proto: 'REST_JSON', target: null, scope: 'appsync', sampleOp: "GET /v1/apis", sampleBody: "" },
  { id: 'athena', proto: 'JSON', target: 'AmazonAthena.', scope: 'athena', sampleOp: "ListWorkGroups", sampleBody: "{}" },
  { id: 'autoscaling', proto: 'QUERY', target: null, scope: 'autoscaling', sampleOp: "DescribeAutoScalingGroups", sampleBody: "" },
  { id: 'backup', proto: 'REST_JSON', target: null, scope: 'backup', sampleOp: "GET /backup-vaults/", sampleBody: "" },
  { id: 'batch', proto: 'REST_JSON', target: null, scope: 'batch', sampleOp: "GET /v1/describejobqueues", sampleBody: "" },
  { id: 'bcm-data-exports', proto: 'JSON', target: 'AWSBillingAndCostManagementDataExports.', scope: 'bcm-data-exports', sampleOp: "ListExports", sampleBody: "{}" },
  { id: 'bedrock-runtime', proto: 'REST_JSON', target: null, scope: 'bedrock', sampleOp: "POST /model/gemma/invoke", sampleBody: "{\"prompt\":\"hi\"}" },
  { id: 'ce', proto: 'JSON', target: 'AWSInsightsIndexService.', scope: 'ce', sampleOp: "GetCostAndUsage", sampleBody: "{\"TimePeriod\":{\"Start\":\"2026-01-01\",\"End\":\"2026-02-01\"},\"Granularity\":\"MONTHLY\",\"Metrics\":[\"UnblendedCost\"]}" },
  { id: 'cloudcontrol', proto: 'JSON', target: 'CloudApiService.', scope: 'cloudcontrolapi', sampleOp: "ListResources", sampleBody: "{\"TypeName\":\"AWS::S3::Bucket\"}", jsonVersion: '1.0' },
  { id: 'cloudformation', proto: 'QUERY', target: null, scope: 'cloudformation', sampleOp: "DescribeStacks", sampleBody: "" },
  { id: 'cloudfront', proto: 'REST_XML', target: null, scope: 'cloudfront', sampleOp: "GET /2020-05-31/distribution", sampleBody: "" },
  { id: 'cloudtrail', proto: 'JSON', target: 'CloudTrail_20131101.', scope: 'cloudtrail', sampleOp: "DescribeTrails", sampleBody: "{}" },
  { id: 'codebuild', proto: 'JSON', target: 'CodeBuild_20161006.', scope: 'codebuild', sampleOp: "ListProjects", sampleBody: "{}" },
  { id: 'codedeploy', proto: 'JSON', target: 'CodeDeploy_20141006.', scope: 'codedeploy', sampleOp: "ListApplications", sampleBody: "{}" },
  { id: 'codepipeline', proto: 'JSON', target: 'CodePipeline_20150709.', scope: 'codepipeline', sampleOp: "ListPipelines", sampleBody: "{}" },
  { id: 'cognito-idp', proto: 'REST_JSON', target: 'AWSCognitoIdentityProviderService.', scope: 'cognito-idp', sampleOp: "ListUserPools", sampleBody: "{\"MaxResults\":50}" },
  { id: 'config', proto: 'JSON', target: 'StarlingDoveService.', scope: 'config', sampleOp: "DescribeConfigRules", sampleBody: "{}" },
  { id: 'cur', proto: 'JSON', target: 'AWSOrigamiServiceGatewayService.', scope: 'cur', sampleOp: "DescribeReportDefinitions", sampleBody: "{}" },
  { id: 'docdb', proto: 'QUERY', target: null, scope: 'docdb', sampleOp: "DescribeDBClusters", sampleBody: "" },
  { id: 'dynamodb', proto: 'JSON', target: 'DynamoDB_20120810.', scope: 'dynamodb', sampleOp: "ListTables", sampleBody: "{}", jsonVersion: '1.0' },
  { id: 'ec2', proto: 'QUERY', target: null, scope: 'ec2', sampleOp: "DescribeInstances", sampleBody: "" },
  { id: 'ecr', proto: 'JSON', target: 'AmazonEC2ContainerRegistry_V20150921.', scope: 'ecr', sampleOp: "DescribeRepositories", sampleBody: "{}" },
  { id: 'ecs', proto: 'JSON', target: 'AmazonEC2ContainerServiceV20141113.', scope: 'ecs', sampleOp: "ListClusters", sampleBody: "{}" },
  { id: 'eks', proto: 'REST_JSON', target: null, scope: 'eks', sampleOp: "GET /clusters", sampleBody: "" },
  { id: 'elasticache', proto: 'QUERY', target: null, scope: 'elasticache', sampleOp: "DescribeCacheClusters", sampleBody: "" },
  { id: 'elasticbeanstalk', proto: 'QUERY', target: null, scope: 'elasticbeanstalk', sampleOp: "DescribeApplications", sampleBody: "" },
  { id: 'elasticloadbalancing', proto: 'QUERY', target: null, scope: 'elasticloadbalancing', sampleOp: "DescribeLoadBalancers", sampleBody: "" },
  { id: 'elasticmapreduce', proto: 'JSON', target: 'ElasticMapReduce.', scope: 'elasticmapreduce', sampleOp: "ListClusters", sampleBody: "{}" },
  { id: 'email', proto: 'REST_JSON', target: null, scope: 'email', sampleOp: "GET /v2/email/identities", sampleBody: "" },
  { id: 'es', proto: 'REST_JSON', target: null, scope: 'es', sampleOp: "GET /2021-01-01/domains", sampleBody: "" },
  { id: 'events', proto: 'JSON', target: 'AWSEvents.', scope: 'events', sampleOp: "ListEventBuses", sampleBody: "{}" },
  { id: 'firehose', proto: 'JSON', target: 'Firehose_20150804.', scope: 'firehose', sampleOp: "ListDeliveryStreams", sampleBody: "{}" },
  { id: 'glue', proto: 'JSON', target: 'AWSGlue.', scope: 'glue', sampleOp: "GetDatabases", sampleBody: "{}" },
  { id: 'iam', proto: 'QUERY', target: null, scope: 'iam', sampleOp: "ListRoles", sampleBody: "" },
  { id: 'iot', proto: 'REST_JSON', target: null, scope: 'iot', sampleOp: "GET /things", sampleBody: "" },
  { id: 'iotdata', proto: 'REST_JSON', target: null, scope: 'iotdata', sampleOp: "", sampleBody: "" },
  { id: 'kafka', proto: 'REST_JSON', target: null, scope: 'kafka', sampleOp: "GET /v1/clusters", sampleBody: "" },
  { id: 'kinesis', proto: 'JSON', target: 'Kinesis_20131202.', scope: 'kinesis', sampleOp: "ListStreams", sampleBody: "{}" },
  { id: 'kms', proto: 'JSON', target: 'TrentService.', scope: 'kms', sampleOp: "ListKeys", sampleBody: "{}" },
  { id: 'lambda', proto: 'REST_JSON', target: null, scope: 'lambda', sampleOp: "GET /2015-03-31/functions", sampleBody: "" },
  { id: 'lightsail', proto: 'JSON', target: 'Lightsail_20161128.', scope: 'lightsail', sampleOp: "GetInstances", sampleBody: "{}" },
  { id: 'logs', proto: 'JSON', target: 'Logs_20140328.', scope: 'logs', sampleOp: "DescribeLogGroups", sampleBody: "{}" },
  { id: 'memorydb', proto: 'JSON', target: 'AmazonMemoryDB.', scope: 'memorydb', sampleOp: "DescribeClusters", sampleBody: "{}" },
  { id: 'monitoring', proto: 'QUERY', target: 'GraniteServiceVersion20100801.', scope: 'monitoring', sampleOp: "ListMetrics", sampleBody: "" },
  { id: 'mq', proto: 'REST_JSON', target: null, scope: 'mq', sampleOp: "GET /v1/brokers", sampleBody: "" },
  { id: 'neptune', proto: 'QUERY', target: null, scope: 'neptune', sampleOp: "DescribeDBClusters", sampleBody: "" },
  { id: 'pipes', proto: 'REST_JSON', target: null, scope: 'pipes', sampleOp: "GET /v1/pipes", sampleBody: "" },
  { id: 'pricing', proto: 'JSON', target: 'AWSPriceListService.', scope: 'pricing', sampleOp: "DescribeServices", sampleBody: "{}" },
  { id: 'rds', proto: 'QUERY', target: null, scope: 'rds', sampleOp: "DescribeDBInstances", sampleBody: "" },
  { id: 'rds-data', proto: 'REST_JSON', target: null, scope: 'rds-data', sampleOp: "POST /Execute", sampleBody: "{\"sql\":\"SELECT 1\"}" },
  { id: 'route53', proto: 'REST_XML', target: null, scope: 'route53', sampleOp: "GET /2013-04-01/hostedzone", sampleBody: "" },
  { id: 's3', proto: 'REST_XML', target: null, scope: 's3', sampleOp: "GET /", sampleBody: "" },
  { id: 's3vectors', proto: 'REST_JSON', target: null, scope: 's3vectors', sampleOp: "POST /ListVectorBuckets", sampleBody: "{}" },
  { id: 'sagemaker', proto: 'JSON', target: 'SageMaker.', scope: 'sagemaker', sampleOp: "ListEndpoints", sampleBody: "{}" },
  { id: 'scheduler', proto: 'JSON', target: null, scope: 'scheduler', sampleOp: "GET /schedules", sampleBody: "" },
  { id: 'secretsmanager', proto: 'JSON', target: 'secretsmanager.', scope: 'secretsmanager', sampleOp: "ListSecrets", sampleBody: "{}" },
  { id: 'servicediscovery', proto: 'JSON', target: 'Route53AutoNaming_v20170314.', scope: 'servicediscovery', sampleOp: "ListNamespaces", sampleBody: "{}" },
  { id: 'sns', proto: 'QUERY', target: 'SNS_20100331.', scope: 'sns', sampleOp: "ListTopics", sampleBody: "" },
  { id: 'sqs', proto: 'QUERY', target: 'AmazonSQS.', scope: 'sqs', sampleOp: "ListQueues", sampleBody: "" },
  { id: 'ssm', proto: 'JSON', target: 'AmazonSSM.', scope: 'ssm', sampleOp: "DescribeParameters", sampleBody: "{}" },
  { id: 'states', proto: 'JSON', target: 'AWSStepFunctions.', scope: 'states', sampleOp: "ListStateMachines", sampleBody: "{}", jsonVersion: '1.0' },
  { id: 'sts', proto: 'QUERY', target: null, scope: 'sts', sampleOp: "GetCallerIdentity", sampleBody: "" },
  { id: 'tagging', proto: 'JSON', target: 'ResourceGroupsTaggingAPI_20170126.', scope: 'tagging', sampleOp: "GetResources", sampleBody: "{}" },
  { id: 'textract', proto: 'JSON', target: 'Textract.', scope: 'textract', sampleOp: "ListAdapters", sampleBody: "{}" },
  { id: 'transcribe', proto: 'JSON', target: 'Transcribe.', scope: 'transcribe', sampleOp: "ListTranscriptionJobs", sampleBody: "{}" },
  { id: 'transfer', proto: 'JSON', target: 'TransferService.', scope: 'transfer', sampleOp: "ListServers", sampleBody: "{}" },
  { id: 'wafv2', proto: 'JSON', target: 'AWSWAF_20190729.', scope: 'wafv2', sampleOp: "ListWebACLs", sampleBody: "{\"Scope\":\"REGIONAL\"}" },
];

export interface ExploreRequest {
  service: string;
  operation: string;
  body?: string;
  region?: string;
}

export interface ExploreResponse {
  status: number;
  contentType: string;
  body: string;
}

const REST_RE = /^(GET|POST|PUT|DELETE|PATCH|HEAD)\s+(\S+)$/i;

export async function explore(endpoint: string, req: ExploreRequest): Promise<ExploreResponse> {
  const svc = EXPLORER_SERVICES.find((s) => s.id === req.service);
  if (!svc) throw new Error(`unknown service: ${req.service}`);
  const region = req.region ?? 'us-east-1';
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const auth = `AWS4-HMAC-SHA256 Credential=explorer/${date}/${region}/${svc.scope}/aws4_request, SignedHeaders=host, Signature=explorer`;
  const operation = req.operation.trim();
  const rest = REST_RE.exec(operation);

  let method = 'POST';
  let url = endpoint.replace(/\/$/, '') + '/';
  const headers: Record<string, string> = { Authorization: auth };
  let payload: string | undefined = req.body?.trim() || undefined;

  if (rest) {
    method = rest[1].toUpperCase();
    url = endpoint.replace(/\/$/, '') + (rest[2].startsWith('/') ? rest[2] : '/' + rest[2]);
    if (payload) headers['Content-Type'] = svc.proto === 'REST_XML' ? 'application/xml' : 'application/json';
  } else if (svc.proto === 'QUERY') {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    payload = `Action=${encodeURIComponent(operation)}` + (payload ? `&${payload}` : '');
  } else if (svc.proto === 'JSON' || svc.proto === 'CBOR' || svc.target) {
    headers['Content-Type'] = `application/x-amz-json-${svc.jsonVersion ?? '1.1'}`;
    headers['X-Amz-Target'] = `${svc.target ?? ''}${operation}`;
    payload = payload ?? '{}';
  } else {
    throw new Error(`service ${svc.id} speaks ${svc.proto} — use "METHOD /path" as the operation`);
  }

  const res = await fetch(url, { method, headers, body: method === 'GET' || method === 'HEAD' ? undefined : payload });
  const text = await res.text();
  return { status: res.status, contentType: res.headers.get('content-type') ?? '', body: text.slice(0, 200_000) };
}
