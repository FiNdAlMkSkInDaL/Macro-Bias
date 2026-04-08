type RetryOptions = {
  baseDelayMs: number;
  maxAttempts: number;
  maxDelayMs: number;
  operationName: string;
  shouldRetry?: (error: unknown, attempt: number) => boolean;
};

function sleep(milliseconds: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getNumericStatusCode(error: unknown) {
  if (!isRecord(error)) {
    return null;
  }

  for (const key of ["status", "statusCode"]) {
    const value = error[key];

    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }

  return null;
}

function shouldRetryByDefault(error: unknown) {
  const statusCode = getNumericStatusCode(error);

  if (statusCode == null) {
    return true;
  }

  return statusCode === 429 || statusCode >= 500;
}

function getRetryDelay(baseDelayMs: number, maxDelayMs: number, attempt: number) {
  return Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
}

export async function withExponentialBackoff<T>(
  operation: () => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      const shouldRetry =
        attempt < options.maxAttempts &&
        (options.shouldRetry?.(error, attempt) ?? shouldRetryByDefault(error));

      if (!shouldRetry) {
        throw error;
      }

      const delayMs = getRetryDelay(options.baseDelayMs, options.maxDelayMs, attempt);
      console.warn(
        `[retry] ${options.operationName} failed on attempt ${attempt}. Retrying in ${delayMs}ms.`,
      );
      await sleep(delayMs);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Retry loop for ${options.operationName} exhausted unexpectedly.`);
}