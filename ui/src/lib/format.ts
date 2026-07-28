export function timeAgo(iso: string | null): string {
  if (!iso) {
    return 'unknown';
  }
  const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000));
  if (seconds < 60) {
    return 'just now';
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  return `${Math.floor(hours / 24)}d ago`;
}

export function timeUntil(iso: string | null): string {
  if (!iso) {
    return 'never';
  }
  const seconds = Math.floor((Date.parse(iso) - Date.now()) / 1000);
  if (seconds <= 0) {
    return 'expiring';
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `in ${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `in ${hours}h ${minutes % 60}m`;
  }
  return `in ${Math.floor(hours / 24)}d ${hours % 24}h`;
}

export function snippets(endpoint: string): { id: string; label: string; code: string }[] {
  return [
    {
      id: 'cli',
      label: 'AWS CLI',
      code: [
        `aws --endpoint-url ${endpoint} s3 mb s3://demo`,
        `aws --endpoint-url ${endpoint} s3 ls`,
        `aws --endpoint-url ${endpoint} sqs create-queue --queue-name jobs`,
      ].join('\n'),
    },
    {
      id: 'env',
      label: 'Env vars',
      code: [
        `export AWS_ENDPOINT_URL=${endpoint}`,
        'export AWS_ACCESS_KEY_ID=test',
        'export AWS_SECRET_ACCESS_KEY=test',
        'export AWS_DEFAULT_REGION=us-east-1',
        '',
        'aws s3 ls',
      ].join('\n'),
    },
    {
      id: 'boto3',
      label: 'boto3',
      code: [
        'import boto3',
        '',
        's3 = boto3.client(',
        '    "s3",',
        `    endpoint_url="${endpoint}",`,
        '    aws_access_key_id="test",',
        '    aws_secret_access_key="test",',
        '    region_name="us-east-1",',
        ')',
        's3.create_bucket(Bucket="demo")',
      ].join('\n'),
    },
  ];
}
