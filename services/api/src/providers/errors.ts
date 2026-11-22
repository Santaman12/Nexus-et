export class ProviderError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export const providerNotConfigured = (provider: string, envName: string) =>
  new ProviderError(
    503,
    'provider-not-configured',
    `${provider} is not configured. Set ${envName} on the backend.`,
  );
