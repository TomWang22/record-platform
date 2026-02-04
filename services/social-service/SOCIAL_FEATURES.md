# Social Service Features (WhatsApp/Discord-style)

## Implemented

### Forum
- **Posts**: Create, get, list, search; flair; upload_type (text/media); attachments; upvotes/downvotes; pin/lock.
- **Edit post**: `PUT /forum/posts/:postId` (owner only).
- **Comments**: Create, list; nested (parent_id); attachments.
- **Attachments**: Post and comment attachments (file_url, thumbnail, mime_type, etc.).

### Messages (P2P + Groups)
- **Send message**: `POST /messages` (direct or group); subject, content, message_type.
- **Edit message**: `PUT /messages/:messageId` (sender only) – subject, content.
- **Reply to message**: `POST /messages/:messageId/reply` – WhatsApp-style reply with `parent_message_id`; response includes `parent_message` preview.
- **Thread**: `GET /messages/thread/:threadId` – full conversation thread.
- **Inbox**: `GET /messages` – user’s messages (direct + group), paginated.
- **Groups**: Create, add/remove members, get details, leave, archive/delete.
- **Attachments**: `POST /messages/:messageId/attachments`, `GET /messages/:messageId/attachments`.
- **Mark read**: `POST /messages/:messageId/read`.
- **Delete message**: `DELETE /messages/:messageId` (sender or recipient).

### Data model
- **Forum**: `forum.posts`, `forum.comments`, `forum.post_attachments`, etc.
- **Messages**: `messages.messages`, `messages.groups`, `messages.group_members`, `messages.message_attachments`, `messages.message_reads` (schema `messages`, not `forum`).

---

## Planned / To Add

### React (emoji reactions)
- **Post reactions**: e.g. `POST /forum/posts/:postId/reactions` with `{ emoji: "👍" }`; store in `forum.post_reactions` (post_id, user_id, emoji); list/count per post.
- **Message reactions**: e.g. `POST /messages/:messageId/reactions`; store in `messages.message_reactions`; list/count per message.

### Reply / @-mention (Discord-style)
- **Reply to a user’s message in thread**: Already supported via `POST /messages/:messageId/reply` and `parent_message` in response.
- **@-mention user**: Parse `content` for `@userId` or `@username`; store mentions in `messages.message_mentions` (message_id, user_id); notify mentioned users; optional `GET /messages?mentioned=true` for “mentioned” inbox.

### Formatting
- **Rich text / markdown**: Accept `content` as markdown or structured format; optional field `content_format: "plain" | "markdown"`; sanitize and render in clients (or store HTML server-side with CSP). Support links, bold, code blocks, lists.

### Optional
- **Edit post/comment history**: Store last N edits or `updated_at` + optional `edit_history` JSON.
- **Reactions count cache**: Cache reaction counts per post/message for list views.

---

## Verification (DB)

- **Forum**: `forum.posts`, `forum.comments` (port 5434, DB `records`).
- **Messages**: `messages.messages` (same DB). Scripts must use `messages.messages`, not `forum.messages`, for message counts.
