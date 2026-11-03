const SAFE_REQUEST_ID = /^[a-zA-Z0-9._:-]{1,128}$/;

export function getRequestId(request: Request): string {
  const supplied = request.headers.get("x-request-id");
  return supplied && SAFE_REQUEST_ID.test(supplied) ? supplied : crypto.randomUUID();
}
