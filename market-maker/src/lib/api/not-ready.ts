export function notReady(fn: string, owner: "matching" | "daphne") {
  return Response.json(
    {
      error: `${fn} is not implemented yet`,
      owner,
    },
    { status: 501 },
  );
}
