/**
 * Live mode stub. No provider is configured in this version, so this route
 * always answers credentials_unavailable. It reads no environment variables,
 * does not read or echo the request, and does not log.
 */
export async function POST() {
  return Response.json(
    {
      status: "credentials_unavailable",
      message: "Live mode is not configured on this deployment. This is not an evaluation result.",
    },
    { status: 503 },
  );
}
