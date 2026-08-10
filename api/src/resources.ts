import {
  CreateTableCommand,
  DeleteTableCommand,
  DynamoDBClient,
  ListTablesCommand,
  PutItemCommand,
  ScanCommand,
} from '@aws-sdk/client-dynamodb';
import {
  AttachRolePolicyCommand,
  CreatePolicyCommand,
  CreateRoleCommand,
  CreateUserCommand,
  DeletePolicyCommand,
  DeleteRoleCommand,
  DeleteUserCommand,
  DetachRolePolicyCommand,
  DetachUserPolicyCommand,
  IAMClient,
  ListAttachedRolePoliciesCommand,
  ListEntitiesForPolicyCommand,
  ListPoliciesCommand,
  ListRolesCommand,
  ListUsersCommand,
} from '@aws-sdk/client-iam';
import {
  CloudWatchLogsClient,
  CreateLogGroupCommand,
  DeleteLogGroupCommand,
  DescribeLogGroupsCommand,
  DescribeLogStreamsCommand,
  FilterLogEventsCommand,
} from '@aws-sdk/client-cloudwatch-logs';
import {
  CreateKeyCommand,
  DecryptCommand,
  DescribeKeyCommand,
  EncryptCommand,
  KMSClient,
  ListKeysCommand,
  ScheduleKeyDeletionCommand,
} from '@aws-sdk/client-kms';
import {
  DeleteParameterCommand,
  GetParameterCommand,
  DescribeParametersCommand,
  PutParameterCommand,
  SSMClient,
} from '@aws-sdk/client-ssm';
import {
  DeleteRuleCommand,
  EventBridgeClient,
  ListRulesCommand,
  PutEventsCommand,
  PutRuleCommand,
} from '@aws-sdk/client-eventbridge';
import {
  CreateStateMachineCommand,
  DeleteStateMachineCommand,
  DescribeExecutionCommand,
  ListExecutionsCommand,
  ListStateMachinesCommand,
  SFNClient,
  StartExecutionCommand,
} from '@aws-sdk/client-sfn';
import {
  CreateStreamCommand,
  DeleteStreamCommand,
  DescribeStreamCommand,
  GetRecordsCommand,
  GetShardIteratorCommand,
  KinesisClient,
  ListStreamsCommand,
  PutRecordCommand,
} from '@aws-sdk/client-kinesis';
import {
  DescribeInstancesCommand,
  EC2Client,
  RunInstancesCommand,
  StartInstancesCommand,
  StopInstancesCommand,
  TerminateInstancesCommand,
} from '@aws-sdk/client-ec2';
import {
  CreateFunctionCommand,
  DeleteFunctionCommand,
  InvokeCommand,
  LambdaClient,
  ListFunctionsCommand,
} from '@aws-sdk/client-lambda';
import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  ListBucketsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import {
  CreateSecretCommand,
  DeleteSecretCommand,
  GetSecretValueCommand,
  ListSecretsCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';
import {
  CreateTopicCommand,
  DeleteTopicCommand,
  ListTopicsCommand,
  PublishCommand,
  SNSClient,
} from '@aws-sdk/client-sns';
import {
  CreateQueueCommand,
  DeleteQueueCommand,
  GetQueueUrlCommand,
  ListQueuesCommand,
  PurgeQueueCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import {
  ApiGatewayV2Client,
  CreateApiCommand,
  CreateRouteCommand,
  DeleteApiCommand,
  GetApisCommand,
  GetRoutesCommand,
  GetStagesCommand,
} from '@aws-sdk/client-apigatewayv2';
import {
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  CognitoIdentityProviderClient,
  CreateUserPoolCommand,
  DeleteUserPoolCommand,
  ListUserPoolsCommand,
  ListUsersCommand as CognitoListUsersCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import {
  ChangeResourceRecordSetsCommand,
  CreateHostedZoneCommand,
  DeleteHostedZoneCommand,
  ListHostedZonesCommand,
  ListResourceRecordSetsCommand,
  Route53Client,
} from '@aws-sdk/client-route-53';
import {
  CloudFormationClient,
  CreateStackCommand,
  DeleteStackCommand,
  DescribeStackEventsCommand,
  DescribeStackResourcesCommand,
  DescribeStacksCommand,
  ListStacksCommand,
} from '@aws-sdk/client-cloudformation';
import {
  CreateRepositoryCommand,
  DeleteRepositoryCommand,
  DescribeImagesCommand,
  DescribeRepositoriesCommand,
  ECRClient,
} from '@aws-sdk/client-ecr';
import {
  CreateEmailIdentityCommand,
  DeleteEmailIdentityCommand,
  ListEmailIdentitiesCommand,
  SendEmailCommand,
  SESv2Client,
} from '@aws-sdk/client-sesv2';
import {
  CreateScheduleCommand,
  DeleteScheduleCommand,
  GetScheduleCommand,
  ListSchedulesCommand,
  SchedulerClient,
} from '@aws-sdk/client-scheduler';
import { strToU8, zipSync } from 'fflate';
import {
  CreateDBInstanceCommand,
  DeleteDBInstanceCommand,
  DescribeDBInstancesCommand,
  RDSClient,
} from '@aws-sdk/client-rds';
import {
  CreateClusterCommand as CreateEcsClusterCommand,
  DeleteClusterCommand as DeleteEcsClusterCommand,
  DescribeClustersCommand as DescribeEcsClustersCommand,
  ECSClient,
  ListClustersCommand as ListEcsClustersCommand,
  ListServicesCommand as ListEcsServicesCommand,
  ListTasksCommand as ListEcsTasksCommand,
} from '@aws-sdk/client-ecs';
import {
  AthenaClient,
  CreateWorkGroupCommand,
  DeleteWorkGroupCommand,
  GetQueryExecutionCommand,
  GetQueryResultsCommand,
  ListWorkGroupsCommand,
  StartQueryExecutionCommand,
} from '@aws-sdk/client-athena';
import {
  CreateDatabaseCommand as CreateGlueDatabaseCommand,
  DeleteDatabaseCommand as DeleteGlueDatabaseCommand,
  GetDatabasesCommand,
  GetTablesCommand,
  GlueClient,
} from '@aws-sdk/client-glue';
import {
  CreateCacheClusterCommand,
  DeleteCacheClusterCommand,
  DescribeCacheClustersCommand,
  ElastiCacheClient,
} from '@aws-sdk/client-elasticache';
import {
  CreateDeliveryStreamCommand,
  DeleteDeliveryStreamCommand,
  DescribeDeliveryStreamCommand,
  FirehoseClient,
  ListDeliveryStreamsCommand,
  PutRecordCommand as FirehosePutRecordCommand,
} from '@aws-sdk/client-firehose';

export const SERVICES = [
  's3',
  'sqs',
  'sns',
  'dynamodb',
  'ec2',
  'lambda',
  'secrets',
  'iam',
  'ssm',
  'logs',
  'kms',
  'events',
  'states',
  'kinesis',
  'apigw',
  'cognito',
  'route53',
  'cloudformation',
  'ecr',
  'ses',
  'scheduler',
  'rds',
  'ecs',
  'athena',
  'glue',
  'elasticache',
  'firehose',
] as const;
export type ServiceId = (typeof SERVICES)[number];

export interface ResourceItem {
  id: string;
  name: string;
  detail?: string;
  createdAt?: string;
}

export interface CreatePayload {
  name: string;
  value?: string;
  runtime?: string;
  handler?: string;
  code?: string;
}

const clientConfig = (endpoint: string, region: string) => ({
  endpoint,
  region,
  credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
});

export class ResourceGateway {
  private endpoint: string;
  private region: string;

  constructor(endpoint: string, region = 'us-east-1') {
    this.endpoint = endpoint;
    this.region = region;
  }

  async list(service: ServiceId): Promise<ResourceItem[]> {
    switch (service) {
      case 's3': {
        const s3 = new S3Client({ ...clientConfig(this.endpoint, this.region), forcePathStyle: true });
        const out = await s3.send(new ListBucketsCommand({}));
        return (out.Buckets ?? []).map((bucket) => ({
          id: bucket.Name ?? '',
          name: bucket.Name ?? '',
          createdAt: bucket.CreationDate?.toISOString(),
        }));
      }
      case 'sqs': {
        const sqs = new SQSClient(clientConfig(this.endpoint, this.region));
        const out = await sqs.send(new ListQueuesCommand({}));
        return (out.QueueUrls ?? []).map((url) => {
          const name = url.split('/').pop() ?? url;
          return { id: name, name, detail: url };
        });
      }
      case 'sns': {
        const sns = new SNSClient(clientConfig(this.endpoint, this.region));
        const out = await sns.send(new ListTopicsCommand({}));
        return (out.Topics ?? []).flatMap((topic) => {
          if (!topic.TopicArn) {
            return [];
          }
          const name = topic.TopicArn.split(':').pop() ?? topic.TopicArn;
          return [{ id: topic.TopicArn, name, detail: topic.TopicArn }];
        });
      }
      case 'dynamodb': {
        const ddb = new DynamoDBClient(clientConfig(this.endpoint, this.region));
        const out = await ddb.send(new ListTablesCommand({}));
        return (out.TableNames ?? []).map((table) => ({ id: table, name: table }));
      }
      case 'ec2': {
        const ec2 = new EC2Client(clientConfig(this.endpoint, this.region));
        const out = await ec2.send(new DescribeInstancesCommand({}));
        const items: ResourceItem[] = [];
        for (const reservation of out.Reservations ?? []) {
          for (const instance of reservation.Instances ?? []) {
            const state = instance.State?.Name ?? 'unknown';
            if (state === 'terminated' || !instance.InstanceId) {
              continue;
            }
            const nameTag = instance.Tags?.find((tag) => tag.Key === 'Name')?.Value;
            items.push({
              id: instance.InstanceId,
              name: nameTag || instance.InstanceId,
              detail: `${instance.InstanceType ?? ''} · ${state}`,
              createdAt: instance.LaunchTime?.toISOString(),
            });
          }
        }
        return items;
      }
      case 'lambda': {
        const lambda = new LambdaClient(clientConfig(this.endpoint, this.region));
        const out = await lambda.send(new ListFunctionsCommand({}));
        return (out.Functions ?? []).flatMap((fn) => {
          if (!fn.FunctionName) {
            return [];
          }
          return [
            {
              id: fn.FunctionName,
              name: fn.FunctionName,
              detail: `${fn.Runtime ?? ''} · ${fn.State ?? fn.LastUpdateStatus ?? ''}`,
              createdAt: fn.LastModified,
            },
          ];
        });
      }
      case 'secrets': {
        const secrets = new SecretsManagerClient(clientConfig(this.endpoint, this.region));
        const out = await secrets.send(new ListSecretsCommand({}));
        return (out.SecretList ?? []).flatMap((secret) => {
          if (!secret.Name) {
            return [];
          }
          return [{ id: secret.Name, name: secret.Name, detail: secret.ARN }];
        });
      }
      case 'iam': {
        const iam = new IAMClient(clientConfig(this.endpoint, this.region));
        const [users, roles, policies] = await Promise.all([
          iam.send(new ListUsersCommand({})),
          iam.send(new ListRolesCommand({})),
          iam.send(new ListPoliciesCommand({ Scope: 'Local' })),
        ]);
        const items: ResourceItem[] = [];
        for (const user of users.Users ?? []) {
          if (!user.UserName) {
            continue;
          }
          items.push({
            id: `user/${user.UserName}`,
            name: user.UserName,
            detail: `user · ${user.Arn ?? ''}`,
            createdAt: user.CreateDate?.toISOString(),
          });
        }
        for (const role of roles.Roles ?? []) {
          if (!role.RoleName) {
            continue;
          }
          items.push({
            id: `role/${role.RoleName}`,
            name: role.RoleName,
            detail: `role · ${role.Arn ?? ''}`,
            createdAt: role.CreateDate?.toISOString(),
          });
        }
        for (const policy of policies.Policies ?? []) {
          if (!policy.Arn) {
            continue;
          }
          items.push({
            id: `policy/${policy.Arn}`,
            name: policy.PolicyName ?? policy.Arn,
            detail: `policy · ${policy.Arn}`,
            createdAt: policy.CreateDate?.toISOString(),
          });
        }
        return items;
      }
      case 'ssm': {
        const ssm = new SSMClient(clientConfig(this.endpoint, this.region));
        const out = await ssm.send(new DescribeParametersCommand({ MaxResults: 50 }));
        return (out.Parameters ?? []).flatMap((param) => {
          if (!param.Name) {
            return [];
          }
          return [
            {
              id: param.Name,
              name: param.Name,
              detail: param.Type,
              createdAt: param.LastModifiedDate?.toISOString(),
            },
          ];
        });
      }
      case 'logs': {
        const logs = new CloudWatchLogsClient(clientConfig(this.endpoint, this.region));
        const out = await logs.send(new DescribeLogGroupsCommand({ limit: 50 }));
        return (out.logGroups ?? []).flatMap((group) => {
          if (!group.logGroupName) {
            return [];
          }
          return [
            {
              id: group.logGroupName,
              name: group.logGroupName,
              detail: group.storedBytes != null ? `${group.storedBytes} bytes stored` : undefined,
              createdAt: group.creationTime ? new Date(group.creationTime).toISOString() : undefined,
            },
          ];
        });
      }
      case 'kms': {
        const kms = new KMSClient(clientConfig(this.endpoint, this.region));
        const out = await kms.send(new ListKeysCommand({ Limit: 50 }));
        const keys = (out.Keys ?? []).filter((key) => key.KeyId);
        const described = await Promise.all(
          keys.map(async (key) => {
            try {
              const meta = await kms.send(new DescribeKeyCommand({ KeyId: key.KeyId }));
              return meta.KeyMetadata;
            } catch {
              return undefined;
            }
          }),
        );
        return keys.map((key, index) => {
          const meta = described[index];
          return {
            id: key.KeyId ?? '',
            name: meta?.Description || (key.KeyId ?? ''),
            detail: meta ? `${meta.KeyState ?? ''} · ${meta.KeyUsage ?? ''}` : undefined,
            createdAt: meta?.CreationDate?.toISOString(),
          };
        });
      }
      case 'events': {
        const events = new EventBridgeClient(clientConfig(this.endpoint, this.region));
        const out = await events.send(new ListRulesCommand({ Limit: 50 }));
        return (out.Rules ?? []).flatMap((rule) => {
          if (!rule.Name) {
            return [];
          }
          const trigger = rule.ScheduleExpression ?? (rule.EventPattern ? 'event pattern' : '');
          return [
            {
              id: rule.Name,
              name: rule.Name,
              detail: [trigger, rule.State?.toLowerCase()].filter(Boolean).join(' · '),
            },
          ];
        });
      }
      case 'states': {
        const sfn = new SFNClient(clientConfig(this.endpoint, this.region));
        const out = await sfn.send(new ListStateMachinesCommand({ maxResults: 50 }));
        return (out.stateMachines ?? []).flatMap((machine) => {
          if (!machine.stateMachineArn || !machine.name) {
            return [];
          }
          return [
            {
              id: machine.stateMachineArn,
              name: machine.name,
              detail: machine.type,
              createdAt: machine.creationDate?.toISOString(),
            },
          ];
        });
      }
      case 'kinesis': {
        const kinesis = new KinesisClient(clientConfig(this.endpoint, this.region));
        const out = await kinesis.send(new ListStreamsCommand({}));
        return (out.StreamNames ?? []).map((stream) => ({ id: stream, name: stream }));
      }
      case 'apigw': {
        const apigw = new ApiGatewayV2Client(clientConfig(this.endpoint, this.region));
        const out = await apigw.send(new GetApisCommand({ MaxResults: '50' }));
        return (out.Items ?? []).flatMap((api) => {
          if (!api.ApiId) {
            return [];
          }
          return [
            {
              id: api.ApiId,
              name: api.Name ?? api.ApiId,
              detail: [api.ProtocolType, api.ApiEndpoint].filter(Boolean).join(' · '),
              createdAt: api.CreatedDate?.toISOString(),
            },
          ];
        });
      }
      case 'cognito': {
        const cognito = new CognitoIdentityProviderClient(clientConfig(this.endpoint, this.region));
        const out = await cognito.send(new ListUserPoolsCommand({ MaxResults: 50 }));
        return (out.UserPools ?? []).flatMap((pool) => {
          if (!pool.Id) {
            return [];
          }
          return [
            {
              id: pool.Id,
              name: pool.Name ?? pool.Id,
              detail: pool.Id,
              createdAt: pool.CreationDate?.toISOString(),
            },
          ];
        });
      }
      case 'route53': {
        const route53 = new Route53Client(clientConfig(this.endpoint, this.region));
        const out = await route53.send(new ListHostedZonesCommand({}));
        return (out.HostedZones ?? []).flatMap((zone) => {
          if (!zone.Id) {
            return [];
          }
          return [
            {
              id: zone.Id.replace('/hostedzone/', ''),
              name: zone.Name ?? zone.Id,
              detail: `${zone.ResourceRecordSetCount ?? 0} records`,
            },
          ];
        });
      }
      case 'cloudformation': {
        const cfn = new CloudFormationClient(clientConfig(this.endpoint, this.region));
        const out = await cfn.send(new ListStacksCommand({}));
        return (out.StackSummaries ?? []).flatMap((stack) => {
          if (!stack.StackName || stack.StackStatus === 'DELETE_COMPLETE') {
            return [];
          }
          return [
            {
              id: stack.StackName,
              name: stack.StackName,
              detail: stack.StackStatus,
              createdAt: stack.CreationTime?.toISOString(),
            },
          ];
        });
      }
      case 'ecr': {
        const ecr = new ECRClient(clientConfig(this.endpoint, this.region));
        const out = await ecr.send(new DescribeRepositoriesCommand({}));
        return (out.repositories ?? []).flatMap((repo) => {
          if (!repo.repositoryName) {
            return [];
          }
          return [
            {
              id: repo.repositoryName,
              name: repo.repositoryName,
              detail: repo.repositoryUri,
              createdAt: repo.createdAt?.toISOString(),
            },
          ];
        });
      }
      case 'ses': {
        const ses = new SESv2Client(clientConfig(this.endpoint, this.region));
        const out = await ses.send(new ListEmailIdentitiesCommand({ PageSize: 50 }));
        return (out.EmailIdentities ?? []).flatMap((identity) => {
          if (!identity.IdentityName) {
            return [];
          }
          return [
            {
              id: identity.IdentityName,
              name: identity.IdentityName,
              detail: [identity.IdentityType, identity.SendingEnabled ? 'sending enabled' : 'sending disabled']
                .filter(Boolean)
                .join(' · '),
            },
          ];
        });
      }
      case 'scheduler': {
        const scheduler = new SchedulerClient(clientConfig(this.endpoint, this.region));
        const out = await scheduler.send(new ListSchedulesCommand({ MaxResults: 50 }));
        return (out.Schedules ?? []).flatMap((schedule) => {
          if (!schedule.Name) {
            return [];
          }
          return [
            {
              id: schedule.Name,
              name: schedule.Name,
              detail: schedule.State?.toLowerCase(),
              createdAt: schedule.CreationDate?.toISOString(),
            },
          ];
        });
      }
      case 'rds': {
        const rds = new RDSClient(clientConfig(this.endpoint, this.region));
        const out = await rds.send(new DescribeDBInstancesCommand({}));
        return (out.DBInstances ?? []).flatMap((db) => {
          if (!db.DBInstanceIdentifier) {
            return [];
          }
          return [
            {
              id: db.DBInstanceIdentifier,
              name: db.DBInstanceIdentifier,
              detail: [db.Engine, db.DBInstanceClass, db.DBInstanceStatus].filter(Boolean).join(' · '),
              createdAt: db.InstanceCreateTime?.toISOString(),
            },
          ];
        });
      }
      case 'ecs': {
        const ecs = new ECSClient(clientConfig(this.endpoint, this.region));
        const arns = (await ecs.send(new ListEcsClustersCommand({}))).clusterArns ?? [];
        if (arns.length === 0) {
          return [];
        }
        const out = await ecs.send(new DescribeEcsClustersCommand({ clusters: arns }));
        return (out.clusters ?? []).flatMap((cluster) => {
          if (!cluster.clusterName) {
            return [];
          }
          return [
            {
              id: cluster.clusterName,
              name: cluster.clusterName,
              detail: `${(cluster.status ?? '').toLowerCase()} · ${cluster.runningTasksCount ?? 0} tasks · ${cluster.activeServicesCount ?? 0} services`,
            },
          ];
        });
      }
      case 'athena': {
        const athena = new AthenaClient(clientConfig(this.endpoint, this.region));
        const out = await athena.send(new ListWorkGroupsCommand({}));
        return (out.WorkGroups ?? []).flatMap((wg) => {
          if (!wg.Name) {
            return [];
          }
          return [
            {
              id: wg.Name,
              name: wg.Name,
              detail: wg.State?.toLowerCase(),
              createdAt: wg.CreationTime?.toISOString(),
            },
          ];
        });
      }
      case 'glue': {
        const glue = new GlueClient(clientConfig(this.endpoint, this.region));
        const out = await glue.send(new GetDatabasesCommand({}));
        return (out.DatabaseList ?? []).flatMap((db) => {
          if (!db.Name) {
            return [];
          }
          return [
            {
              id: db.Name,
              name: db.Name,
              detail: db.Description,
              createdAt: db.CreateTime?.toISOString(),
            },
          ];
        });
      }
      case 'elasticache': {
        const ec = new ElastiCacheClient(clientConfig(this.endpoint, this.region));
        const out = await ec.send(new DescribeCacheClustersCommand({}));
        return (out.CacheClusters ?? []).flatMap((cluster) => {
          if (!cluster.CacheClusterId) {
            return [];
          }
          return [
            {
              id: cluster.CacheClusterId,
              name: cluster.CacheClusterId,
              detail: [cluster.Engine, cluster.CacheNodeType, cluster.CacheClusterStatus].filter(Boolean).join(' · '),
              createdAt: cluster.CacheClusterCreateTime?.toISOString(),
            },
          ];
        });
      }
      case 'firehose': {
        const firehose = new FirehoseClient(clientConfig(this.endpoint, this.region));
        const out = await firehose.send(new ListDeliveryStreamsCommand({ Limit: 50 }));
        return (out.DeliveryStreamNames ?? []).map((name) => ({ id: name, name }));
      }
    }
  }

  async create(service: ServiceId, payload: CreatePayload): Promise<ResourceItem> {
    const { name, value } = payload;
    switch (service) {
      case 's3': {
        const s3 = new S3Client({ ...clientConfig(this.endpoint, this.region), forcePathStyle: true });
        await s3.send(new CreateBucketCommand({ Bucket: name }));
        return { id: name, name };
      }
      case 'sqs': {
        const sqs = new SQSClient(clientConfig(this.endpoint, this.region));
        const out = await sqs.send(new CreateQueueCommand({ QueueName: name }));
        return { id: name, name, detail: out.QueueUrl };
      }
      case 'sns': {
        const sns = new SNSClient(clientConfig(this.endpoint, this.region));
        const out = await sns.send(new CreateTopicCommand({ Name: name }));
        return { id: out.TopicArn ?? name, name, detail: out.TopicArn };
      }
      case 'dynamodb': {
        const ddb = new DynamoDBClient(clientConfig(this.endpoint, this.region));
        await ddb.send(
          new CreateTableCommand({
            TableName: name,
            AttributeDefinitions: [{ AttributeName: 'id', AttributeType: 'S' }],
            KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
            BillingMode: 'PAY_PER_REQUEST',
          }),
        );
        return { id: name, name, detail: 'partition key: id (S)' };
      }
      case 'ec2': {
        const ec2 = new EC2Client(clientConfig(this.endpoint, this.region));
        const out = await ec2.send(
          new RunInstancesCommand({
            ImageId: 'ami-0abcdef1234567890',
            InstanceType: 't3.micro',
            MinCount: 1,
            MaxCount: 1,
            TagSpecifications: [
              { ResourceType: 'instance', Tags: [{ Key: 'Name', Value: name }] },
            ],
          }),
        );
        const instance = out.Instances?.[0];
        return {
          id: instance?.InstanceId ?? name,
          name,
          detail: `${instance?.InstanceType ?? 't3.micro'} · ${instance?.State?.Name ?? 'pending'}`,
        };
      }
      case 'lambda': {
        const lambda = new LambdaClient(clientConfig(this.endpoint, this.region));
        const runtime = payload.runtime ?? 'nodejs20.x';
        const isPython = runtime.startsWith('python');
        const fileName = isPython ? 'lambda_function.py' : 'index.mjs';
        const handler = payload.handler ?? (isPython ? 'lambda_function.lambda_handler' : 'index.handler');
        const code = payload.code ?? '';
        const zip = zipSync({ [fileName]: strToU8(code) });
        const out = await lambda.send(
          new CreateFunctionCommand({
            FunctionName: name,
            Runtime: runtime as never,
            Handler: handler,
            Role: 'arn:aws:iam::000000000000:role/lambda',
            Code: { ZipFile: zip },
            Timeout: 30,
          }),
        );
        return { id: name, name, detail: `${runtime} · ${out.State ?? 'Pending'}` };
      }
      case 'secrets': {
        const secrets = new SecretsManagerClient(clientConfig(this.endpoint, this.region));
        const out = await secrets.send(
          new CreateSecretCommand({ Name: name, SecretString: value ?? '' }),
        );
        return { id: name, name, detail: out.ARN };
      }
      case 'iam': {
        const iam = new IAMClient(clientConfig(this.endpoint, this.region));
        const kind = value === 'role' || value === 'policy' ? value : 'user';
        if (kind === 'role') {
          const assumeRole = JSON.stringify({
            Version: '2012-10-17',
            Statement: [
              {
                Effect: 'Allow',
                Principal: { Service: 'lambda.amazonaws.com' },
                Action: 'sts:AssumeRole',
              },
            ],
          });
          const out = await iam.send(
            new CreateRoleCommand({ RoleName: name, AssumeRolePolicyDocument: assumeRole }),
          );
          return { id: `role/${name}`, name, detail: `role · ${out.Role?.Arn ?? ''}` };
        }
        if (kind === 'policy') {
          const document = JSON.stringify({
            Version: '2012-10-17',
            Statement: [{ Effect: 'Allow', Action: 's3:GetObject', Resource: '*' }],
          });
          const out = await iam.send(
            new CreatePolicyCommand({ PolicyName: name, PolicyDocument: document }),
          );
          const arn = out.Policy?.Arn ?? name;
          return { id: `policy/${arn}`, name, detail: `policy · ${arn}` };
        }
        const out = await iam.send(new CreateUserCommand({ UserName: name }));
        return { id: `user/${name}`, name, detail: `user · ${out.User?.Arn ?? ''}` };
      }
      case 'ssm': {
        const ssm = new SSMClient(clientConfig(this.endpoint, this.region));
        await ssm.send(
          new PutParameterCommand({ Name: name, Value: value ?? '', Type: 'String', Overwrite: true }),
        );
        return { id: name, name, detail: 'String' };
      }
      case 'logs': {
        const logs = new CloudWatchLogsClient(clientConfig(this.endpoint, this.region));
        await logs.send(new CreateLogGroupCommand({ logGroupName: name }));
        return { id: name, name };
      }
      case 'kms': {
        const kms = new KMSClient(clientConfig(this.endpoint, this.region));
        const out = await kms.send(new CreateKeyCommand({ Description: name }));
        const keyId = out.KeyMetadata?.KeyId ?? name;
        return {
          id: keyId,
          name: name || keyId,
          detail: `${out.KeyMetadata?.KeyState ?? 'Enabled'} · ${out.KeyMetadata?.KeyUsage ?? 'ENCRYPT_DECRYPT'}`,
        };
      }
      case 'events': {
        const events = new EventBridgeClient(clientConfig(this.endpoint, this.region));
        const trigger = (value ?? '').trim();
        const isPattern = trigger.startsWith('{');
        await events.send(
          new PutRuleCommand({
            Name: name,
            ...(isPattern
              ? { EventPattern: trigger }
              : { ScheduleExpression: trigger || 'rate(5 minutes)' }),
            State: 'ENABLED',
          }),
        );
        return { id: name, name, detail: isPattern ? 'event pattern · enabled' : `${trigger || 'rate(5 minutes)'} · enabled` };
      }
      case 'states': {
        const sfn = new SFNClient(clientConfig(this.endpoint, this.region));
        const definition =
          payload.code ??
          JSON.stringify({
            Comment: 'Hello world state machine',
            StartAt: 'Hello',
            States: { Hello: { Type: 'Pass', Result: 'Hello from floci', End: true } },
          });
        const out = await sfn.send(
          new CreateStateMachineCommand({
            name,
            definition,
            roleArn: 'arn:aws:iam::000000000000:role/sfn',
          }),
        );
        return { id: out.stateMachineArn ?? name, name, detail: 'STANDARD' };
      }
      case 'kinesis': {
        const kinesis = new KinesisClient(clientConfig(this.endpoint, this.region));
        await kinesis.send(new CreateStreamCommand({ StreamName: name, ShardCount: 1 }));
        return { id: name, name, detail: '1 shard' };
      }
      case 'apigw': {
        const apigw = new ApiGatewayV2Client(clientConfig(this.endpoint, this.region));
        const out = await apigw.send(new CreateApiCommand({ Name: name, ProtocolType: 'HTTP' }));
        return {
          id: out.ApiId ?? name,
          name,
          detail: ['HTTP', out.ApiEndpoint].filter(Boolean).join(' · '),
        };
      }
      case 'cognito': {
        const cognito = new CognitoIdentityProviderClient(clientConfig(this.endpoint, this.region));
        const out = await cognito.send(new CreateUserPoolCommand({ PoolName: name }));
        const poolId = out.UserPool?.Id ?? name;
        return { id: poolId, name, detail: poolId };
      }
      case 'route53': {
        const route53 = new Route53Client(clientConfig(this.endpoint, this.region));
        const out = await route53.send(
          new CreateHostedZoneCommand({ Name: name, CallerReference: `console-${Date.now()}` }),
        );
        const zoneId = (out.HostedZone?.Id ?? name).replace('/hostedzone/', '');
        return { id: zoneId, name: out.HostedZone?.Name ?? name, detail: `${out.HostedZone?.ResourceRecordSetCount ?? 0} records` };
      }
      case 'cloudformation': {
        const cfn = new CloudFormationClient(clientConfig(this.endpoint, this.region));
        const template =
          payload.code ??
          JSON.stringify({
            AWSTemplateFormatVersion: '2010-09-09',
            Resources: {
              ConsoleBucket: {
                Type: 'AWS::S3::Bucket',
                Properties: { BucketName: `${name}-bucket` },
              },
            },
          });
        await cfn.send(new CreateStackCommand({ StackName: name, TemplateBody: template }));
        return { id: name, name, detail: 'CREATE_IN_PROGRESS' };
      }
      case 'ecr': {
        const ecr = new ECRClient(clientConfig(this.endpoint, this.region));
        const out = await ecr.send(new CreateRepositoryCommand({ repositoryName: name }));
        return { id: name, name, detail: out.repository?.repositoryUri };
      }
      case 'ses': {
        const ses = new SESv2Client(clientConfig(this.endpoint, this.region));
        const out = await ses.send(new CreateEmailIdentityCommand({ EmailIdentity: name }));
        return {
          id: name,
          name,
          detail: [out.IdentityType, out.VerifiedForSendingStatus ? 'verified' : 'pending verification']
            .filter(Boolean)
            .join(' · '),
        };
      }
      case 'scheduler': {
        const scheduler = new SchedulerClient(clientConfig(this.endpoint, this.region));
        const expression = (value ?? '').trim() || 'rate(5 minutes)';
        await scheduler.send(
          new CreateScheduleCommand({
            Name: name,
            ScheduleExpression: expression,
            FlexibleTimeWindow: { Mode: 'OFF' },
            Target: {
              Arn: 'arn:aws:lambda:us-east-1:000000000000:function:console-target',
              RoleArn: 'arn:aws:iam::000000000000:role/scheduler',
            },
          }),
        );
        return { id: name, name, detail: `${expression} · enabled` };
      }
      case 'rds': {
        const rds = new RDSClient(clientConfig(this.endpoint, this.region));
        const engine = (value ?? '').trim() || 'postgres';
        const out = await rds.send(
          new CreateDBInstanceCommand({
            DBInstanceIdentifier: name,
            Engine: engine,
            DBInstanceClass: 'db.t3.micro',
            MasterUsername: 'admin',
            MasterUserPassword: 'password123',
            AllocatedStorage: 20,
          }),
        );
        return {
          id: name,
          name,
          detail: [out.DBInstance?.Engine ?? engine, out.DBInstance?.DBInstanceStatus ?? 'creating'].join(' · '),
        };
      }
      case 'ecs': {
        const ecs = new ECSClient(clientConfig(this.endpoint, this.region));
        const out = await ecs.send(new CreateEcsClusterCommand({ clusterName: name }));
        return { id: name, name, detail: (out.cluster?.status ?? 'ACTIVE').toLowerCase() };
      }
      case 'athena': {
        const athena = new AthenaClient(clientConfig(this.endpoint, this.region));
        await athena.send(new CreateWorkGroupCommand({ Name: name, Description: value || undefined }));
        return { id: name, name, detail: 'enabled' };
      }
      case 'glue': {
        const glue = new GlueClient(clientConfig(this.endpoint, this.region));
        await glue.send(new CreateGlueDatabaseCommand({ DatabaseInput: { Name: name, Description: value || undefined } }));
        return { id: name, name, detail: value || undefined };
      }
      case 'elasticache': {
        const ec = new ElastiCacheClient(clientConfig(this.endpoint, this.region));
        const out = await ec.send(
          new CreateCacheClusterCommand({
            CacheClusterId: name,
            Engine: 'memcached',
            CacheNodeType: 'cache.t3.micro',
            NumCacheNodes: 1,
          }),
        );
        return {
          id: name,
          name,
          detail: ['memcached', out.CacheCluster?.CacheClusterStatus ?? 'creating'].join(' · '),
        };
      }
      case 'firehose': {
        const firehose = new FirehoseClient(clientConfig(this.endpoint, this.region));
        const bucket = (value ?? '').trim() || 'firehose-data';
        const out = await firehose.send(
          new CreateDeliveryStreamCommand({
            DeliveryStreamName: name,
            DeliveryStreamType: 'DirectPut',
            S3DestinationConfiguration: {
              RoleARN: 'arn:aws:iam::000000000000:role/firehose-delivery',
              BucketARN: `arn:aws:s3:::${bucket}`,
            },
          }),
        );
        return { id: name, name, detail: out.DeliveryStreamARN ?? `→ s3://${bucket}` };
      }
    }
  }

  async remove(service: ServiceId, id: string): Promise<void> {
    switch (service) {
      case 's3': {
        const s3 = new S3Client({ ...clientConfig(this.endpoint, this.region), forcePathStyle: true });
        await s3.send(new DeleteBucketCommand({ Bucket: id }));
        return;
      }
      case 'sqs': {
        const sqs = new SQSClient(clientConfig(this.endpoint, this.region));
        const urlOut = await sqs.send(new GetQueueUrlCommand({ QueueName: id }));
        if (urlOut.QueueUrl) {
          await sqs.send(new DeleteQueueCommand({ QueueUrl: urlOut.QueueUrl }));
        }
        return;
      }
      case 'sns': {
        const sns = new SNSClient(clientConfig(this.endpoint, this.region));
        await sns.send(new DeleteTopicCommand({ TopicArn: id }));
        return;
      }
      case 'dynamodb': {
        const ddb = new DynamoDBClient(clientConfig(this.endpoint, this.region));
        await ddb.send(new DeleteTableCommand({ TableName: id }));
        return;
      }
      case 'ec2': {
        const ec2 = new EC2Client(clientConfig(this.endpoint, this.region));
        await ec2.send(new TerminateInstancesCommand({ InstanceIds: [id] }));
        return;
      }
      case 'lambda': {
        const lambda = new LambdaClient(clientConfig(this.endpoint, this.region));
        await lambda.send(new DeleteFunctionCommand({ FunctionName: id }));
        return;
      }
      case 'secrets': {
        const secrets = new SecretsManagerClient(clientConfig(this.endpoint, this.region));
        await secrets.send(
          new DeleteSecretCommand({ SecretId: id, ForceDeleteWithoutRecovery: true }),
        );
        return;
      }
      case 'iam': {
        const iam = new IAMClient(clientConfig(this.endpoint, this.region));
        if (id.startsWith('role/')) {
          const roleName = id.slice('role/'.length);
          const attached = await iam.send(new ListAttachedRolePoliciesCommand({ RoleName: roleName }));
          for (const policy of attached.AttachedPolicies ?? []) {
            if (policy.PolicyArn) {
              await iam.send(
                new DetachRolePolicyCommand({ RoleName: roleName, PolicyArn: policy.PolicyArn }),
              );
            }
          }
          await iam.send(new DeleteRoleCommand({ RoleName: roleName }));
          return;
        }
        if (id.startsWith('policy/')) {
          const policyArn = id.slice('policy/'.length);
          try {
            const entities = await iam.send(new ListEntitiesForPolicyCommand({ PolicyArn: policyArn }));
            for (const role of entities.PolicyRoles ?? []) {
              if (role.RoleName) {
                await iam.send(new DetachRolePolicyCommand({ RoleName: role.RoleName, PolicyArn: policyArn }));
              }
            }
            for (const user of entities.PolicyUsers ?? []) {
              if (user.UserName) {
                await iam.send(new DetachUserPolicyCommand({ UserName: user.UserName, PolicyArn: policyArn }));
              }
            }
          } catch {
            // ListEntitiesForPolicy not supported on all backends; try direct delete
          }
          await iam.send(new DeletePolicyCommand({ PolicyArn: policyArn }));
          return;
        }
        await iam.send(new DeleteUserCommand({ UserName: id.replace(/^user\//, '') }));
        return;
      }
      case 'ssm': {
        const ssm = new SSMClient(clientConfig(this.endpoint, this.region));
        await ssm.send(new DeleteParameterCommand({ Name: id }));
        return;
      }
      case 'logs': {
        const logs = new CloudWatchLogsClient(clientConfig(this.endpoint, this.region));
        await logs.send(new DeleteLogGroupCommand({ logGroupName: id }));
        return;
      }
      case 'kms': {
        const kms = new KMSClient(clientConfig(this.endpoint, this.region));
        await kms.send(new ScheduleKeyDeletionCommand({ KeyId: id, PendingWindowInDays: 7 }));
        return;
      }
      case 'events': {
        const events = new EventBridgeClient(clientConfig(this.endpoint, this.region));
        await events.send(new DeleteRuleCommand({ Name: id, Force: true }));
        return;
      }
      case 'states': {
        const sfn = new SFNClient(clientConfig(this.endpoint, this.region));
        await sfn.send(new DeleteStateMachineCommand({ stateMachineArn: id }));
        return;
      }
      case 'kinesis': {
        const kinesis = new KinesisClient(clientConfig(this.endpoint, this.region));
        await kinesis.send(new DeleteStreamCommand({ StreamName: id }));
        return;
      }
      case 'apigw': {
        const apigw = new ApiGatewayV2Client(clientConfig(this.endpoint, this.region));
        await apigw.send(new DeleteApiCommand({ ApiId: id }));
        return;
      }
      case 'cognito': {
        const cognito = new CognitoIdentityProviderClient(clientConfig(this.endpoint, this.region));
        await cognito.send(new DeleteUserPoolCommand({ UserPoolId: id }));
        return;
      }
      case 'route53': {
        const route53 = new Route53Client(clientConfig(this.endpoint, this.region));
        const sets = await route53.send(new ListResourceRecordSetsCommand({ HostedZoneId: id }));
        const custom = (sets.ResourceRecordSets ?? []).filter(
          (record) => record.Type !== 'NS' && record.Type !== 'SOA',
        );
        for (const record of custom) {
          await route53.send(
            new ChangeResourceRecordSetsCommand({
              HostedZoneId: id,
              ChangeBatch: { Changes: [{ Action: 'DELETE', ResourceRecordSet: record }] },
            }),
          );
        }
        await route53.send(new DeleteHostedZoneCommand({ Id: id }));
        return;
      }
      case 'cloudformation': {
        const cfn = new CloudFormationClient(clientConfig(this.endpoint, this.region));
        await cfn.send(new DeleteStackCommand({ StackName: id }));
        return;
      }
      case 'ecr': {
        const ecr = new ECRClient(clientConfig(this.endpoint, this.region));
        await ecr.send(new DeleteRepositoryCommand({ repositoryName: id, force: true }));
        return;
      }
      case 'ses': {
        const ses = new SESv2Client(clientConfig(this.endpoint, this.region));
        await ses.send(new DeleteEmailIdentityCommand({ EmailIdentity: id }));
        return;
      }
      case 'scheduler': {
        const scheduler = new SchedulerClient(clientConfig(this.endpoint, this.region));
        await scheduler.send(new DeleteScheduleCommand({ Name: id }));
        return;
      }
      case 'rds': {
        const rds = new RDSClient(clientConfig(this.endpoint, this.region));
        await rds.send(new DeleteDBInstanceCommand({ DBInstanceIdentifier: id, SkipFinalSnapshot: true }));
        return;
      }
      case 'ecs': {
        const ecs = new ECSClient(clientConfig(this.endpoint, this.region));
        await ecs.send(new DeleteEcsClusterCommand({ cluster: id }));
        return;
      }
      case 'athena': {
        const athena = new AthenaClient(clientConfig(this.endpoint, this.region));
        await athena.send(new DeleteWorkGroupCommand({ WorkGroup: id, RecursiveDeleteOption: true }));
        return;
      }
      case 'glue': {
        const glue = new GlueClient(clientConfig(this.endpoint, this.region));
        await glue.send(new DeleteGlueDatabaseCommand({ Name: id }));
        return;
      }
      case 'elasticache': {
        const ec = new ElastiCacheClient(clientConfig(this.endpoint, this.region));
        await ec.send(new DeleteCacheClusterCommand({ CacheClusterId: id }));
        return;
      }
      case 'firehose': {
        const firehose = new FirehoseClient(clientConfig(this.endpoint, this.region));
        await firehose.send(new DeleteDeliveryStreamCommand({ DeliveryStreamName: id }));
        return;
      }
    }
  }

  async act(service: ServiceId, id: string, action: string, body: Record<string, unknown>): Promise<unknown> {
    const str = (key: string): string => {
      const raw = body[key];
      return typeof raw === 'string' ? raw : '';
    };
    switch (service) {
      case 's3': {
        const s3 = new S3Client({ ...clientConfig(this.endpoint, this.region), forcePathStyle: true });
        if (action === 'objects') {
          const out = await s3.send(new ListObjectsV2Command({ Bucket: id, MaxKeys: 100 }));
          return {
            objects: (out.Contents ?? []).map((obj) => ({
              key: obj.Key,
              size: obj.Size,
              lastModified: obj.LastModified?.toISOString(),
            })),
          };
        }
        if (action === 'putObject') {
          const base64 = str('contentBase64');
          await s3.send(
            new PutObjectCommand({
              Bucket: id,
              Key: str('key'),
              Body: base64 ? Buffer.from(base64, 'base64') : str('content'),
              ...(str('contentType') ? { ContentType: str('contentType') } : {}),
            }),
          );
          return { ok: true };
        }
        if (action === 'getObject') {
          const out = await s3.send(new GetObjectCommand({ Bucket: id, Key: str('key') }));
          const text = (await out.Body?.transformToString()) ?? '';
          return { key: str('key'), content: text.slice(0, 10_000) };
        }
        if (action === 'downloadObject') {
          const out = await s3.send(new GetObjectCommand({ Bucket: id, Key: str('key') }));
          const bytes = (await out.Body?.transformToByteArray()) ?? new Uint8Array();
          if (bytes.byteLength > 25 * 1024 * 1024) {
            throw new Error('object larger than 25 MiB — use the AWS CLI to download it');
          }
          return {
            key: str('key'),
            contentBase64: Buffer.from(bytes).toString('base64'),
            contentType: out.ContentType ?? 'application/octet-stream',
          };
        }
        if (action === 'deleteObject') {
          await s3.send(new DeleteObjectCommand({ Bucket: id, Key: str('key') }));
          return { ok: true };
        }
        break;
      }
      case 'sqs': {
        const sqs = new SQSClient(clientConfig(this.endpoint, this.region));
        const urlOut = await sqs.send(new GetQueueUrlCommand({ QueueName: id }));
        const queueUrl = urlOut.QueueUrl;
        if (!queueUrl) {
          throw new Error(`queue ${id} not found`);
        }
        if (action === 'send') {
          const out = await sqs.send(
            new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: str('message') }),
          );
          return { messageId: out.MessageId };
        }
        if (action === 'receive') {
          const out = await sqs.send(
            new ReceiveMessageCommand({ QueueUrl: queueUrl, MaxNumberOfMessages: 10 }),
          );
          return {
            messages: (out.Messages ?? []).map((message) => ({
              id: message.MessageId,
              body: message.Body,
            })),
          };
        }
        if (action === 'purge') {
          await sqs.send(new PurgeQueueCommand({ QueueUrl: queueUrl }));
          return { ok: true };
        }
        break;
      }
      case 'sns': {
        const sns = new SNSClient(clientConfig(this.endpoint, this.region));
        if (action === 'publish') {
          const out = await sns.send(
            new PublishCommand({ TopicArn: id, Message: str('message') }),
          );
          return { messageId: out.MessageId };
        }
        break;
      }
      case 'dynamodb': {
        const ddb = new DynamoDBClient(clientConfig(this.endpoint, this.region));
        if (action === 'scan') {
          const out = await ddb.send(new ScanCommand({ TableName: id, Limit: 25 }));
          return { items: (out.Items ?? []).map((item) => unmarshall(item)) };
        }
        if (action === 'putItem') {
          const parsed = JSON.parse(str('item')) as Record<string, unknown>;
          if (typeof parsed.id !== 'string' || parsed.id.length === 0) {
            throw new Error('item must include a string "id" attribute');
          }
          await ddb.send(new PutItemCommand({ TableName: id, Item: marshall(parsed) }));
          return { ok: true };
        }
        break;
      }
      case 'ec2': {
        const ec2 = new EC2Client(clientConfig(this.endpoint, this.region));
        if (action === 'start') {
          await ec2.send(new StartInstancesCommand({ InstanceIds: [id] }));
          return { ok: true };
        }
        if (action === 'stop') {
          await ec2.send(new StopInstancesCommand({ InstanceIds: [id] }));
          return { ok: true };
        }
        break;
      }
      case 'lambda': {
        const lambda = new LambdaClient(clientConfig(this.endpoint, this.region));
        if (action === 'invoke') {
          const payload = str('payload') || '{}';
          const out = await lambda.send(
            new InvokeCommand({
              FunctionName: id,
              Payload: strToU8(payload),
            }),
          );
          const responsePayload = out.Payload ? new TextDecoder().decode(out.Payload) : '';
          return {
            statusCode: out.StatusCode,
            functionError: out.FunctionError ?? null,
            payload: responsePayload,
          };
        }
        break;
      }
      case 'secrets': {
        const secrets = new SecretsManagerClient(clientConfig(this.endpoint, this.region));
        if (action === 'reveal') {
          const out = await secrets.send(new GetSecretValueCommand({ SecretId: id }));
          return { value: out.SecretString ?? '' };
        }
        break;
      }
      case 'iam': {
        const iam = new IAMClient(clientConfig(this.endpoint, this.region));
        if (action === 'attached' && id.startsWith('role/')) {
          const out = await iam.send(
            new ListAttachedRolePoliciesCommand({ RoleName: id.slice('role/'.length) }),
          );
          return {
            policies: (out.AttachedPolicies ?? []).map((policy) => ({
              name: policy.PolicyName,
              arn: policy.PolicyArn,
            })),
          };
        }
        if (action === 'attachPolicy' && id.startsWith('role/')) {
          await iam.send(
            new AttachRolePolicyCommand({
              RoleName: id.slice('role/'.length),
              PolicyArn: str('policyArn'),
            }),
          );
          return { ok: true };
        }
        break;
      }
      case 'ssm': {
        const ssm = new SSMClient(clientConfig(this.endpoint, this.region));
        if (action === 'reveal') {
          const out = await ssm.send(new GetParameterCommand({ Name: id, WithDecryption: true }));
          return { value: out.Parameter?.Value ?? '' };
        }
        break;
      }
      case 'logs': {
        const logs = new CloudWatchLogsClient(clientConfig(this.endpoint, this.region));
        if (action === 'streams') {
          const out = await logs.send(
            new DescribeLogStreamsCommand({ logGroupName: id, limit: 20, orderBy: 'LastEventTime', descending: true }),
          );
          return {
            streams: (out.logStreams ?? []).map((stream) => ({
              name: stream.logStreamName,
              lastEvent: stream.lastEventTimestamp
                ? new Date(stream.lastEventTimestamp).toISOString()
                : null,
            })),
          };
        }
        if (action === 'tail') {
          const out = await logs.send(new FilterLogEventsCommand({ logGroupName: id, limit: 50 }));
          return {
            events: (out.events ?? []).map((event) => ({
              timestamp: event.timestamp ? new Date(event.timestamp).toISOString() : null,
              stream: event.logStreamName,
              message: event.message,
            })),
          };
        }
        break;
      }
      case 'kms': {
        const kms = new KMSClient(clientConfig(this.endpoint, this.region));
        if (action === 'describe') {
          const out = await kms.send(new DescribeKeyCommand({ KeyId: id }));
          const meta = out.KeyMetadata;
          return {
            keyId: meta?.KeyId,
            arn: meta?.Arn,
            state: meta?.KeyState,
            usage: meta?.KeyUsage,
            description: meta?.Description,
            created: meta?.CreationDate?.toISOString(),
          };
        }
        if (action === 'encrypt') {
          const out = await kms.send(
            new EncryptCommand({ KeyId: id, Plaintext: strToU8(str('plaintext')) }),
          );
          const blob = out.CiphertextBlob ?? new Uint8Array();
          return { ciphertext: Buffer.from(blob).toString('base64') };
        }
        if (action === 'decrypt') {
          const out = await kms.send(
            new DecryptCommand({
              KeyId: id,
              CiphertextBlob: Buffer.from(str('ciphertext'), 'base64'),
            }),
          );
          const plain = out.Plaintext ? new TextDecoder().decode(out.Plaintext) : '';
          return { plaintext: plain };
        }
        break;
      }
      case 'events': {
        const events = new EventBridgeClient(clientConfig(this.endpoint, this.region));
        if (action === 'putEvents') {
          const out = await events.send(
            new PutEventsCommand({
              Entries: [
                {
                  Source: str('source') || 'floci.console',
                  DetailType: str('detailType') || 'test-event',
                  Detail: str('detail') || '{"hello":"world"}',
                },
              ],
            }),
          );
          return {
            failed: out.FailedEntryCount ?? 0,
            entries: (out.Entries ?? []).map((entry) => ({
              eventId: entry.EventId,
              errorCode: entry.ErrorCode ?? null,
            })),
          };
        }
        break;
      }
      case 'states': {
        const sfn = new SFNClient(clientConfig(this.endpoint, this.region));
        if (action === 'start') {
          const out = await sfn.send(
            new StartExecutionCommand({ stateMachineArn: id, input: str('input') || '{}' }),
          );
          return { executionArn: out.executionArn, startDate: out.startDate?.toISOString() };
        }
        if (action === 'executions') {
          const out = await sfn.send(
            new ListExecutionsCommand({ stateMachineArn: id, maxResults: 20 }),
          );
          return {
            executions: (out.executions ?? []).map((execution) => ({
              arn: execution.executionArn,
              name: execution.name,
              status: execution.status,
              started: execution.startDate?.toISOString(),
              stopped: execution.stopDate?.toISOString() ?? null,
            })),
          };
        }
        if (action === 'describeExecution') {
          const out = await sfn.send(new DescribeExecutionCommand({ executionArn: str('arn') }));
          return {
            status: out.status,
            input: out.input,
            output: out.output ?? null,
            started: out.startDate?.toISOString(),
            stopped: out.stopDate?.toISOString() ?? null,
          };
        }
        break;
      }
      case 'kinesis': {
        const kinesis = new KinesisClient(clientConfig(this.endpoint, this.region));
        if (action === 'putRecord') {
          const out = await kinesis.send(
            new PutRecordCommand({
              StreamName: id,
              Data: strToU8(str('data')),
              PartitionKey: str('key') || 'console',
            }),
          );
          return { shardId: out.ShardId, sequenceNumber: out.SequenceNumber };
        }
        if (action === 'read') {
          const desc = await kinesis.send(new DescribeStreamCommand({ StreamName: id }));
          const shardId = desc.StreamDescription?.Shards?.[0]?.ShardId;
          if (!shardId) {
            return { records: [] };
          }
          const iter = await kinesis.send(
            new GetShardIteratorCommand({
              StreamName: id,
              ShardId: shardId,
              ShardIteratorType: 'TRIM_HORIZON',
            }),
          );
          if (!iter.ShardIterator) {
            return { records: [] };
          }
          const out = await kinesis.send(
            new GetRecordsCommand({ ShardIterator: iter.ShardIterator, Limit: 25 }),
          );
          return {
            records: (out.Records ?? []).map((record) => ({
              partitionKey: record.PartitionKey,
              sequenceNumber: record.SequenceNumber,
              data: record.Data ? new TextDecoder().decode(record.Data) : '',
              arrived: record.ApproximateArrivalTimestamp?.toISOString(),
            })),
          };
        }
        break;
      }
      case 'apigw': {
        const apigw = new ApiGatewayV2Client(clientConfig(this.endpoint, this.region));
        if (action === 'routes') {
          const out = await apigw.send(new GetRoutesCommand({ ApiId: id, MaxResults: '50' }));
          return {
            routes: (out.Items ?? []).map((route) => ({
              id: route.RouteId,
              key: route.RouteKey,
              target: route.Target ?? null,
            })),
          };
        }
        if (action === 'addRoute') {
          const out = await apigw.send(
            new CreateRouteCommand({ ApiId: id, RouteKey: str('routeKey') || 'GET /' }),
          );
          return { id: out.RouteId, key: out.RouteKey };
        }
        if (action === 'stages') {
          const out = await apigw.send(new GetStagesCommand({ ApiId: id, MaxResults: '50' }));
          return {
            stages: (out.Items ?? []).map((stage) => ({
              name: stage.StageName,
              autoDeploy: stage.AutoDeploy ?? false,
              deployed: stage.LastUpdatedDate?.toISOString(),
            })),
          };
        }
        break;
      }
      case 'cognito': {
        const cognito = new CognitoIdentityProviderClient(clientConfig(this.endpoint, this.region));
        if (action === 'users') {
          const out = await cognito.send(new CognitoListUsersCommand({ UserPoolId: id, Limit: 50 }));
          return {
            users: (out.Users ?? []).map((user) => ({
              username: user.Username,
              status: user.UserStatus,
              enabled: user.Enabled ?? true,
              created: user.UserCreateDate?.toISOString(),
              email: user.Attributes?.find((attr) => attr.Name === 'email')?.Value ?? null,
            })),
          };
        }
        if (action === 'createUser') {
          const username = str('username');
          const out = await cognito.send(
            new AdminCreateUserCommand({
              UserPoolId: id,
              Username: username,
              MessageAction: 'SUPPRESS',
              TemporaryPassword: 'Console-Temp1!',
              UserAttributes: username.includes('@')
                ? [{ Name: 'email', Value: username }]
                : undefined,
            }),
          );
          return { username: out.User?.Username, status: out.User?.UserStatus };
        }
        if (action === 'deleteUser') {
          await cognito.send(new AdminDeleteUserCommand({ UserPoolId: id, Username: str('username') }));
          return { deleted: true };
        }
        break;
      }
      case 'route53': {
        const route53 = new Route53Client(clientConfig(this.endpoint, this.region));
        if (action === 'records') {
          const out = await route53.send(new ListResourceRecordSetsCommand({ HostedZoneId: id }));
          return {
            records: (out.ResourceRecordSets ?? []).map((record) => ({
              name: record.Name,
              type: record.Type,
              ttl: record.TTL ?? null,
              values: (record.ResourceRecords ?? []).map((rr) => rr.Value),
            })),
          };
        }
        if (action === 'upsertRecord') {
          const recordName = str('recordName');
          const type = str('type') || 'A';
          const recordValue = str('value') || '127.0.0.1';
          await route53.send(
            new ChangeResourceRecordSetsCommand({
              HostedZoneId: id,
              ChangeBatch: {
                Changes: [
                  {
                    Action: 'UPSERT',
                    ResourceRecordSet: {
                      Name: recordName,
                      Type: type as 'A' | 'AAAA' | 'CNAME' | 'TXT' | 'MX' | 'NS',
                      TTL: 300,
                      ResourceRecords: [{ Value: recordValue }],
                    },
                  },
                ],
              },
            }),
          );
          return { upserted: true, name: recordName, type };
        }
        break;
      }
      case 'cloudformation': {
        const cfn = new CloudFormationClient(clientConfig(this.endpoint, this.region));
        if (action === 'describe') {
          const out = await cfn.send(new DescribeStacksCommand({ StackName: id }));
          const stack = out.Stacks?.[0];
          return {
            status: stack?.StackStatus,
            statusReason: stack?.StackStatusReason ?? null,
            outputs: (stack?.Outputs ?? []).map((output) => ({
              key: output.OutputKey,
              value: output.OutputValue,
            })),
          };
        }
        if (action === 'events') {
          const out = await cfn.send(new DescribeStackEventsCommand({ StackName: id }));
          return {
            events: (out.StackEvents ?? []).slice(0, 20).map((event) => ({
              at: event.Timestamp?.toISOString(),
              logicalId: event.LogicalResourceId,
              type: event.ResourceType,
              status: event.ResourceStatus,
              reason: event.ResourceStatusReason ?? null,
            })),
          };
        }
        if (action === 'resources') {
          const out = await cfn.send(new DescribeStackResourcesCommand({ StackName: id }));
          return {
            resources: (out.StackResources ?? []).map((resource) => ({
              logicalId: resource.LogicalResourceId,
              physicalId: resource.PhysicalResourceId ?? null,
              type: resource.ResourceType,
              status: resource.ResourceStatus,
            })),
          };
        }
        break;
      }
      case 'ecr': {
        const ecr = new ECRClient(clientConfig(this.endpoint, this.region));
        if (action === 'images') {
          const out = await ecr.send(new DescribeImagesCommand({ repositoryName: id }));
          return {
            images: (out.imageDetails ?? []).map((image) => ({
              tags: image.imageTags ?? [],
              digest: image.imageDigest,
              sizeBytes: image.imageSizeInBytes ?? null,
              pushed: image.imagePushedAt?.toISOString(),
            })),
          };
        }
        break;
      }
      case 'ses': {
        const ses = new SESv2Client(clientConfig(this.endpoint, this.region));
        if (action === 'send') {
          const out = await ses.send(
            new SendEmailCommand({
              FromEmailAddress: id,
              Destination: { ToAddresses: [str('to') || id] },
              Content: {
                Simple: {
                  Subject: { Data: str('subject') || 'Test from floci console' },
                  Body: { Text: { Data: str('body') || 'Hello from floci.' } },
                },
              },
            }),
          );
          return { messageId: out.MessageId };
        }
        break;
      }
      case 'scheduler': {
        const scheduler = new SchedulerClient(clientConfig(this.endpoint, this.region));
        if (action === 'describe') {
          const out = await scheduler.send(new GetScheduleCommand({ Name: id }));
          return {
            name: out.Name,
            expression: out.ScheduleExpression,
            state: out.State,
            target: out.Target?.Arn ?? null,
          };
        }
        break;
      }
      case 'rds': {
        const rds = new RDSClient(clientConfig(this.endpoint, this.region));
        if (action === 'describe') {
          const out = await rds.send(new DescribeDBInstancesCommand({ DBInstanceIdentifier: id }));
          const db = out.DBInstances?.[0];
          return {
            identifier: db?.DBInstanceIdentifier,
            engine: [db?.Engine, db?.EngineVersion].filter(Boolean).join(' '),
            class: db?.DBInstanceClass,
            status: db?.DBInstanceStatus,
            endpoint: db?.Endpoint?.Address ? `${db.Endpoint.Address}:${db.Endpoint.Port ?? ''}` : null,
            username: db?.MasterUsername,
            storageGb: db?.AllocatedStorage,
            created: db?.InstanceCreateTime?.toISOString() ?? null,
          };
        }
        break;
      }
      case 'ecs': {
        const ecs = new ECSClient(clientConfig(this.endpoint, this.region));
        if (action === 'describe') {
          const [described, services, tasks] = await Promise.all([
            ecs.send(new DescribeEcsClustersCommand({ clusters: [id] })),
            ecs.send(new ListEcsServicesCommand({ cluster: id })).catch(() => ({ serviceArns: [] })),
            ecs.send(new ListEcsTasksCommand({ cluster: id })).catch(() => ({ taskArns: [] })),
          ]);
          const cluster = described.clusters?.[0];
          return {
            name: cluster?.clusterName,
            status: cluster?.status,
            runningTasks: cluster?.runningTasksCount ?? 0,
            pendingTasks: cluster?.pendingTasksCount ?? 0,
            services: (services.serviceArns ?? []).map((arn) => arn.split('/').pop() ?? arn),
            tasks: (tasks.taskArns ?? []).map((arn) => arn.split('/').pop() ?? arn),
          };
        }
        break;
      }
      case 'athena': {
        const athena = new AthenaClient(clientConfig(this.endpoint, this.region));
        if (action === 'query') {
          const sql = str('sql').trim();
          if (!sql) {
            throw new Error('sql is required');
          }
          const started = await athena.send(
            new StartQueryExecutionCommand({
              QueryString: sql,
              WorkGroup: id,
              ResultConfiguration: { OutputLocation: 's3://floci-athena-results/results/' },
            }),
          );
          const executionId = started.QueryExecutionId ?? '';
          let state = 'QUEUED';
          let reason: string | null = null;
          for (let attempt = 0; attempt < 30; attempt += 1) {
            const exec = await athena.send(new GetQueryExecutionCommand({ QueryExecutionId: executionId }));
            state = exec.QueryExecution?.Status?.State ?? 'UNKNOWN';
            reason = exec.QueryExecution?.Status?.StateChangeReason ?? null;
            if (state === 'SUCCEEDED' || state === 'FAILED' || state === 'CANCELLED') {
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, 500));
          }
          if (state !== 'SUCCEEDED') {
            return { executionId, state, reason, columns: [], rows: [] };
          }
          const results = await athena.send(
            new GetQueryResultsCommand({ QueryExecutionId: executionId, MaxResults: 100 }),
          );
          const allRows = (results.ResultSet?.Rows ?? []).map(
            (row) => (row.Data ?? []).map((datum) => datum.VarCharValue ?? ''),
          );
          const columns =
            results.ResultSet?.ResultSetMetadata?.ColumnInfo?.map((col) => col.Name ?? '') ?? allRows[0] ?? [];
          const rows = allRows.length > 1 || columns.length === 0 ? allRows.slice(columns.length > 0 ? 1 : 0) : [];
          return { executionId, state, reason, columns, rows };
        }
        break;
      }
      case 'glue': {
        const glue = new GlueClient(clientConfig(this.endpoint, this.region));
        if (action === 'tables') {
          const out = await glue.send(new GetTablesCommand({ DatabaseName: id }));
          return {
            tables: (out.TableList ?? []).map((table) => ({
              name: table.Name,
              location: table.StorageDescriptor?.Location ?? null,
              format: table.Parameters?.classification ?? table.StorageDescriptor?.InputFormat ?? null,
              columns: (table.StorageDescriptor?.Columns ?? []).map((col) => `${col.Name}:${col.Type ?? '?'}`),
            })),
          };
        }
        break;
      }
      case 'elasticache': {
        const ec = new ElastiCacheClient(clientConfig(this.endpoint, this.region));
        if (action === 'describe') {
          const out = await ec.send(
            new DescribeCacheClustersCommand({ CacheClusterId: id, ShowCacheNodeInfo: true }),
          );
          const cluster = out.CacheClusters?.[0];
          return {
            id: cluster?.CacheClusterId,
            engine: [cluster?.Engine, cluster?.EngineVersion].filter(Boolean).join(' '),
            nodeType: cluster?.CacheNodeType,
            status: cluster?.CacheClusterStatus,
            nodes: (cluster?.CacheNodes ?? []).map((node) =>
              node.Endpoint?.Address ? `${node.Endpoint.Address}:${node.Endpoint.Port ?? ''}` : node.CacheNodeId ?? '',
            ),
          };
        }
        break;
      }
      case 'firehose': {
        const firehose = new FirehoseClient(clientConfig(this.endpoint, this.region));
        if (action === 'describe') {
          const out = await firehose.send(new DescribeDeliveryStreamCommand({ DeliveryStreamName: id }));
          const desc = out.DeliveryStreamDescription;
          return {
            name: desc?.DeliveryStreamName,
            status: desc?.DeliveryStreamStatus,
            type: desc?.DeliveryStreamType,
            arn: desc?.DeliveryStreamARN,
            destinations: (desc?.Destinations ?? []).map(
              (dest) =>
                dest.S3DestinationDescription?.BucketARN ??
                dest.ExtendedS3DestinationDescription?.BucketARN ??
                dest.DestinationId ??
                '',
            ),
          };
        }
        if (action === 'put-record') {
          const data = str('data') || '{"hello":"floci"}';
          const out = await firehose.send(
            new FirehosePutRecordCommand({
              DeliveryStreamName: id,
              Record: { Data: new TextEncoder().encode(`${data}\n`) },
            }),
          );
          return { recordId: out.RecordId };
        }
        break;
      }
    }
    throw new Error(`unsupported action "${action}" for service ${service}`);
  }
}

export function isServiceId(value: string): value is ServiceId {
  return (SERVICES as readonly string[]).includes(value);
}
