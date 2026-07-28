import {
  CreateTableCommand,
  DeleteTableCommand,
  DynamoDBClient,
  ListTablesCommand,
  PutItemCommand,
  ScanCommand,
} from '@aws-sdk/client-dynamodb';
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
import { strToU8, zipSync } from 'fflate';

export const SERVICES = ['s3', 'sqs', 'sns', 'dynamodb', 'ec2', 'lambda', 'secrets'] as const;
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
          await s3.send(
            new PutObjectCommand({ Bucket: id, Key: str('key'), Body: str('content') }),
          );
          return { ok: true };
        }
        if (action === 'getObject') {
          const out = await s3.send(new GetObjectCommand({ Bucket: id, Key: str('key') }));
          const text = (await out.Body?.transformToString()) ?? '';
          return { key: str('key'), content: text.slice(0, 10_000) };
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
    }
    throw new Error(`unsupported action "${action}" for service ${service}`);
  }
}

export function isServiceId(value: string): value is ServiceId {
  return (SERVICES as readonly string[]).includes(value);
}
