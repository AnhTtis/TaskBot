# TaskBot

TaskBot là bot quản lý công việc chạy trực tiếp trong Discord cho nhóm nhỏ và vừa.

Thay vì web dashboard riêng, TaskBot dùng chính Discord làm giao diện vận hành:
- 1 **dashboard summary** trong `#task-dashboard`
- 1 **task card** cho mỗi task
- 1 **public workspace thread** cho mỗi task đang hoạt động
- SQLite/Prisma làm **source of truth**
- các thao tác hằng ngày chủ yếu đi qua **buttons + modal + panel ephemeral/private**

---

## 1. Trạng thái hiện tại

- Version hiện tại: `0.1.0`
- Mức độ hoàn thiện: **MVP+ vận hành được**
- Phù hợp nhất cho:
  - 1 Discord server chính
  - 1 bot process
  - 1 SQLite database trên persistent storage
  - nhóm cộng tác nhỏ cần quản lý task ngay trong Discord

---

## 2. TaskBot hiện hỗ trợ gì

### 2.1. Dashboard và workflow
- summary dashboard tự refresh khi task thay đổi
- task card chi tiết cho từng task
- workflow trạng thái:
  - `BACKLOG`
  - `IN_PROGRESS`
  - `BLOCKED`
  - `REVIEW`
  - `DONE`
- workspace thread public tự tạo/mở lại khi cần
- repair dashboard/card/thread từ DB
- reminder deadline riêng tư qua DM

### 2.2. Team-based task
- task có `team_size`
- 1 task có thể có nhiều thành viên
- `Join Task` chỉ hiện khi task còn thiếu người
- summary hiển thị active teams

### 2.3. Quyền vận hành
- `Admin` là role quản lý chính
- có thể cấu hình thêm manager/reviewer role trong `/setup`
- contributor claim/join hiện vẫn phụ thuộc tên role Discord:
  - `Technician`
  - `Researcher`

---

## 3. Command surface hiện tại

TaskBot hiện **không dùng slash command cho phần quản lý task hằng ngày** nữa, ngoại trừ 1 command fallback cho upload file.

### Slash commands còn giữ lại

| Command | Mục đích | Ai dùng |
|---|---|---|
| `/ping` | kiểm tra bot còn online không | mọi người |
| `/setup` | cấu hình bot cho server | người có `Manage Server` |
| `/task add-attachment` | fallback upload file attachment vào task | manager/configured manager |

### Ý nghĩa của `/task add-attachment`
Command này tồn tại để xử lý giới hạn kỹ thuật của Discord: nút/modal không mở file picker native như slash attachment option.

Bot sẽ cố giữ:
- **tên file gốc đúng như Discord gửi cho bot**
- **không chủ động bỏ dấu / không slugify / không rename**

---

## 4. Flow nút hiện tại

## 4.1. Summary dashboard buttons

Ngay dưới summary dashboard sẽ có các nút:
- `My Tasks`
- `Review Queue`
- `Create Task`
- `Manager Console`

### Ý nghĩa
- `My Tasks`: xem các task active của chính bạn
- `Review Queue`: reviewer/manager xem các task đang chờ review
- `Create Task`: manager tạo task mới bằng modal
- `Manager Console`: manager mở panel vận hành riêng

---

## 4.2. Task card public buttons

Task card public chỉ giữ các nút cơ bản, tùy theo trạng thái task.

### `BACKLOG`
- `Claim`
- `Open Task`

### `IN_PROGRESS` / `BLOCKED`
- `Join Task` *(nếu còn slot)*
- `Progress`
- `Open Workspace` *(nếu đã có thread)*

### `REVIEW`
- `Review`
- `Open Workspace`

### `DONE`
- `Results`
- `Open Workspace`

Lưu ý:
- cùng một public message Discord **không thể hiện bộ nút khác nhau cho từng người xem**
- vì vậy các nút nhạy cảm được đưa vào **panel ephemeral/private** sau khi bấm

---

## 4.3. Panel private theo role và trạng thái

Khi bấm nút public trên task card, bot sẽ mở panel private phù hợp với task state và quyền của người bấm.

### Trước khi task được nhận (`BACKLOG`)
- contributor đủ role có thể `Claim`
- manager có nút `Update Task`
- `Update Task` mở hub quản lý gồm:
  - `Update Details`
  - `Update Deadline` / `Clear Deadline`
  - `Attachments`
  - `Repair Task`

### Sau khi task đã active
#### `IN_PROGRESS`
- task member / manager có thể:
  - `Block`
  - `Done / Review`
- người khác nếu đủ role và còn slot có thể `Join Task`

#### `BLOCKED`
- task member / manager có thể `Unblock`

#### `REVIEW`
- reviewer / manager có thể:
  - `Approve`
  - `Request Changes`

#### `DONE`
- reviewer / manager có thể `Reopen`

### Tối ưu nút
Bot nên cập nhật lại:
- **public task card** nếu state đổi
- **panel private của người vừa bấm** nếu có thể

Mục tiêu là bấm xong thấy đúng nút tiếp theo, hạn chế phải mở lại panel nhiều lần.

---

## 4.4. Attachment flow bằng nút

Trong `Update Task` -> `Attachments`, manager sẽ có panel riêng để:
- `Add URL`
- `Add File`
- `Remove Attachment`

### `Add URL`
- mở modal để nhập link
- có thể thêm note/label

### `Add File`
- bot hiển thị hướng dẫn upload file
- upload file thật hiện vẫn đi qua command fallback:
  - `/task add-attachment`
- giới hạn file theo **Discord/server upload limit**

### `Remove Attachment`
- gỡ attachment khỏi task

### Nguyên tắc tên file
- file attachment hiển thị ưu tiên theo `fileName`
- bot **không chủ động đổi tên file**
- bot **không chủ động bỏ dấu tiếng Việt**
- label/note là metadata riêng, không thay thế tên file gốc

---

## 5. Setup Discord server như thế nào

## 5.1. Role nên có
Khuyến nghị role chuẩn:
- `Admin`
- `Technician`
- `Researcher`

### Ý nghĩa
- `Admin`: vận hành bot, setup, review, repair
- `Technician`: contributor cho task kỹ thuật
- `Researcher`: contributor cho task nghiên cứu

### Quan trọng
Code hiện tại kiểm tra claim/join contributor theo **đúng tên role Discord**:
- `Technician`
- `Researcher`

Nếu bạn đổi tên khác, claim/join sẽ lệch logic hiện tại.

---

## 5.2. Channel nên có
Khuyến nghị tối thiểu:

### Category: TASKBOT
- `#task-dashboard`
- `#task-feed`
- `#task-archive` *(optional)*

### Category: THẢO LUẬN
- `#chung`

TaskBot dùng:
- `#task-dashboard` để post summary + task cards
- `#task-feed` để post repair notice / sync report / lỗi vận hành
- workspace chính là **thread động** dưới task card, không cần tạo quá nhiều channel tĩnh

---

## 5.3. Quyền bot cần có
Bot nên được invite với scopes:
- `bot`
- `applications.commands`

Bot cần đủ quyền ở dashboard/feed/thread:
- xem channel
- gửi tin nhắn
- xem lịch sử tin nhắn
- embed links
- attach files
- tạo public thread
- gửi tin nhắn trong thread
- manage threads

Người chạy `/setup` cần có:
- `Manage Server` / `ManageGuild`

---

## 5.4. Chạy `/setup`
Sau khi bot vào server, chạy:

```text
/setup
```

### Các field chính trong `/setup`
- `dashboard_channel`
- `feed_channel`
- `archive_channel` *(optional)*
- `admin_role`
- `secondary_manager_role` *(optional)*
- `reviewer_role` *(optional)*
- `secondary_reviewer_role` *(optional)*
- `max_active_tasks`
- `thread_auto_archive_minutes`
- `default_timezone`
- `default_date_input_mode`

### Kết quả sau `/setup`
- bot lưu config vào DB
- bot tạo/update summary dashboard
- summary dashboard sẽ có các nút:
  - `My Tasks`
  - `Review Queue`
  - `Create Task`
  - `Manager Console`

Nếu summary cũ không có nút mới, chạy lại `/setup` sau khi deploy bản mới.

---

## 6. Cách dùng hằng ngày

## 6.1. Manager
Manager thường làm các việc:
1. vào `#task-dashboard`
2. bấm `Create Task` để tạo task mới
3. bấm `Manager Console` khi cần repair
4. mở task card -> bấm `Open Task` / `Progress` / `Review` / `Results`
5. nếu task còn `BACKLOG`, dùng `Update Task` để tinh chỉnh trước khi ai đó nhận

## 6.2. Contributor
Contributor thường làm các việc:
1. mở task card `BACKLOG`
2. bấm `Claim` nếu đúng role
3. nếu task đã active và còn slot, bấm `Join Task`
4. làm việc trong `Open Workspace`
5. khi đang làm:
   - `Block`
   - `Done / Review`

## 6.3. Reviewer
Reviewer thường làm các việc:
1. bấm `Review Queue`
2. mở task card đang `REVIEW`
3. bấm `Review`
4. chọn:
   - `Approve`
   - `Request Changes`

---

## 7. Cài đặt và chạy local

## Yêu cầu
- Node.js `>=24.0.0`
- npm
- bot Discord đã tạo trong Developer Portal
- `.env` dựa trên `.env.example`

### Ví dụ `.env` local
```env
DISCORD_TOKEN=your_bot_token_here
CLIENT_ID=your_discord_application_id_here
DATABASE_URL=file:./dev.db
GUILD_ID=your_test_server_id_here
NODE_ENV=development
```

## Các bước local
1. Cài dependency:
   ```bash
   npm install
   ```
2. Generate Prisma client:
   ```bash
   npm run prisma:generate
   ```
3. Chạy migration local:
   ```bash
   npm run prisma:migrate:dev
   ```
4. Register slash commands:
   ```bash
   npm run register:commands
   ```
5. Chạy bot:
   ```bash
   npm run dev
   ```
6. Trong Discord:
   - test `/ping`
   - chạy `/setup`
   - bấm `Create Task` từ summary dashboard

Nếu PowerShell chặn `npm.ps1`, dùng `npm.cmd` thay cho `npm`.

---

## 8. Deploy production

TaskBot **không phải web app HTTP**. Hãy deploy như một **background worker / long-running process**.

### Mô hình khuyến nghị
- 1 VPS hoặc máy luôn bật
- 1 process bot
- PM2 giữ process sống
- SQLite trên persistent storage

### Ví dụ `.env` production
```env
DISCORD_TOKEN=your_bot_token_here
CLIENT_ID=your_discord_application_id_here
DATABASE_URL=file:/opt/taskbot/data/taskbot.db
NODE_ENV=production
```

### Quy trình deploy
1. Clone source code lên host
2. Tạo `.env`
3. Cài dependency sạch:
   ```bash
   npm ci
   ```
4. Validate Prisma schema:
   ```bash
   npm run prisma:validate
   ```
5. Generate Prisma client:
   ```bash
   npm run prisma:generate
   ```
6. Chạy migration production:
   ```bash
   npm run prisma:migrate:deploy
   ```
7. Register slash commands:
   ```bash
   npm run register:commands
   ```
8. Build app:
   ```bash
   npm run build
   ```
9. Start bot:
   ```bash
   npm run start
   ```

### PM2
```bash
pm2 start npm --name taskbot -- run start
pm2 logs taskbot
pm2 restart taskbot
pm2 save
```

---

## 9. Scripts chính

| Script | Mục đích |
|---|---|
| `npm run dev` | chạy bot ở watch mode |
| `npm run build` | build TypeScript ra `dist/` |
| `npm run start` | chạy bản build production |
| `npm run typecheck` | kiểm tra TypeScript |
| `npm run clean` | xóa `dist/` |
| `npm run register:commands` | register slash commands |
| `npm run prisma:generate` | generate Prisma client |
| `npm run prisma:validate` | validate Prisma schema |
| `npm run prisma:migrate:dev` | migration local |
| `npm run prisma:migrate:deploy` | migration production |

---

## 10. Troubleshooting nhanh

Nếu bot có vấn đề, kiểm tra theo thứ tự:
1. test `/ping`
2. kiểm tra log `Logged in as ...`
3. kiểm tra `.env`
4. kiểm tra command đã register chưa
5. kiểm tra quyền bot ở dashboard/feed/thread
6. chạy lại `/setup`
7. nếu Discord state lệch, vào `Manager Console` -> `Repair Dashboard`

### Khi không thấy nút trên summary
Thường là do summary cũ chưa được update component mới.

Chạy lại:
```bash
npm run register:commands
npm run build
pm2 restart taskbot
```

Sau đó trong Discord chạy lại:
```text
/setup
```

---

## 11. Giới hạn hiện tại

- backend hiện là SQLite, chưa phải DB multi-instance
- chỉ nên chạy **1 instance bot**
- chưa có Dockerfile chính thức
- chưa có backup automation
- chưa có CI/test suite hoàn chỉnh
- `archive_channel` hiện mới là metadata/config, chưa auto-post task done vào đó
- contributor claim/join vẫn phụ thuộc tên role Discord `Technician` và `Researcher`
- file upload attachment vẫn cần command fallback `/task add-attachment`

---

## 12. License

`package.json` hiện để `UNLICENSED`.

Hãy coi repo này là private/internal cho tới khi bạn chủ động đổi license và chính sách phát hành.
