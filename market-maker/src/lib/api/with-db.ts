export class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function withDb<T>(load: () => Promise<T>): Promise<Response> {
  try {
    const data = await load();
    return Response.json(data);
  } catch (error) {
    if (error instanceof HttpError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message.includes("DATABASE_URL") ? 503 : 500;
    return Response.json({ error: message }, { status });
  }
}
