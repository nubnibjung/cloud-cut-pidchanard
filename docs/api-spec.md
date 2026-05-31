# API Spec

Primary endpoints implemented in the prototype:

- `POST /auth/register`
- `POST /auth/login`
- `GET /auth/me`
- `GET /projects?workspaceId=...`
- `GET /projects/:id`
- `POST /projects/:id/clips`
- `PATCH /projects/:id/clips/:clipId`
- `POST /projects/:id/clips/:clipId/split`
- `DELETE /projects/:id/clips/:clipId`
- `POST /assets/confirm-upload`
- `POST /projects/:id/exports`
- `GET /projects/:id/operations?afterSeq=...`

Error response:

```json
{
  "statusCode": 403,
  "error": "Forbidden",
  "message": "You do not have editor access to this project",
  "requestId": "req_..."
}
```
