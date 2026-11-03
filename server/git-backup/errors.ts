/**
 * A failure worth showing the reader as is: a missing setting, a repository
 * that does not exist, an error message relayed from Forgejo or GitHub. The
 * status is the HTTP status the route answers with.
 */
export class GitBackupError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message)
    this.name = 'GitBackupError'
  }
}

/** Pull the most useful message out of a failed Forgejo or GitHub response. */
export async function describeFailure(service: string, res: Response): Promise<string> {
  let detail = ''
  try {
    const body = await res.json() as { message?: unknown }
    if (typeof body.message === 'string') detail = body.message
  } catch {
    // Not JSON — the status alone has to do.
  }
  return `${service} answered ${res.status}${detail ? `: ${detail}` : ''}`
}
