# TaskBot

TaskBot là bot quản lý công việc chạy trực tiếp trong Discord cho nhóm nhỏ và vừa.

Thay vì web dashboard riêng, TaskBot dùng chính Discord làm giao diện vận hành:
- 1 **dashboard summary** trong `#task-dashboard`
- 1 **task card** cho mỗi task
- 1 **public workspace thread** cho mỗi task đang hoạt động
- SQLite/Prisma làm **source of truth**
- các thao tác hằng ngày đi qua **buttons + modal + panel ephemeral/private**

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
- deadline reminder riêng tư qua DM
- nút reload dashboard để đồng bộ lại summary/card/thread khi Discord state bị lệch

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

TaskBot hiện chỉ giữ lại **2 slash command kỹ thuật**:

| Command | Mục đích | Ai dùng |
|---|---|---|
| `/ping` | kiểm tra bot còn online không | mọi người |
| `/setup` | cấu hình bot cho server | người có `Manage Server` |

Không còn slash command cho create/edit/update/attachment task hằng ngày.

---

## 4. Flow nút hiện tại

## 4.1. Summary dashboard buttons

Ngay dưới summary dashboard sẽ có các nút:
- `My Tasks`
- `Review Queue`
- `Create Task`
- `Reload Dashboard`

### Ý nghĩa
- `My Tasks`: xem các task active của chính bạn
- `Review Queue`: reviewer/manager xem các task đang chờ review
- `Create Task`: manager tạo task mới
- `Reload Dashboard`: manager chạy đồng bộ lại dashboard/card/thread ngay lập tức, không mở panel trung gian

---

## 4.2. Tạo task

### Bước 1: Create Task
Manager bấm `Create Task` để mở modal tạo task cơ bản:
- title
- description
- required role
- team size
- deadline *(optional)*

### Bước 2: Edit Task ngay sau khi tạo
Sau khi tạo xong, bot **mở ngay panel `Edit Task`** để manager có thể làm tiếp mà không phải mở console khác:
- edit details *(bao gồm priority nếu cần chỉnh)*
- deadline
- add link attachment
- add file attachment
- quản lý attachment hiện có bằng nút:
  - `⚙️` để edit
  - `✖️` để delete

Vì vậy create flow hiện bao gồm deadline ngay từ đầu và attachment ngay sau khi tạo.

---

## 4.3. Task card public buttons

Task card public chỉ giữ các nút cơ bản, tùy theo trạng thái task.

### `BACKLOG`
- `Claim`
- `Open Task`

### `IN_PROGRESS`
- `Join Task` *(nếu còn slot)*
- `Progress`
- `Open Workspace` *(nếu đã có thread)*

### `BLOCKED`
- `Join Task` *(nếu còn slot)*
- `Progress`
- `Open Workspace`

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

## 4.4. Panel private theo role và trạng thái

Khi bấm nút public trên task card, bot sẽ mở panel private phù hợp với task state và quyền của người bấm.

### `BACKLOG`
- contributor đủ role có thể `Claim`
- manager có nút `Edit Task`
- `Edit Task` là panel quản lý thống nhất, gồm:
  - `Details`
  - `Deadline`
  - `Link`
  - `Add File`
  - attachment hiện có với nút:
    - `⚙️` để edit
    - `✖️` để delete

### `IN_PROGRESS`
- người làm task sẽ thấy nút `Done`
- manager/admin sẽ thấy:
  - `Edit Task`
  - `Block`
- nếu một người **vừa là task member vừa là admin/manager**, họ vẫn sẽ thấy `Done` vì họ là người làm task
- người khác nếu đủ role và còn slot có thể `Join Task`
- khi người làm bấm `Done`, task chuyển sang `REVIEW`

### `BLOCKED`
- task member / manager có thể `Unblock`
- manager vẫn có `Edit Task`

### `REVIEW`
- reviewer / manager có thể:
  - `Approve`
  - `Request Changes`
- manager vẫn có `Edit Task` nếu cần chỉnh metadata/deadline/attachment
- trạng thái này xuất hiện sau khi người làm bấm `Done`
- nếu người đó cũng là admin/reviewer thì lúc này họ sẽ thấy `Approve`

### `DONE`
- reviewer / manager có thể `Reopen`
- nếu có `archive_channel`, task card completed sẽ được chuyển sang archive channel

### Tối ưu nút
Bot sẽ cố cập nhật lại:
- **public task card** nếu state đổi
- **private panel của người vừa bấm**
- **summary dashboard**

Mục tiêu là bấm xong thấy đúng nút tiếp theo, hạn chế phải mở lại panel nhiều lần.

---

## 4.5. Attachment flow bằng nút

Attachment giờ đi hoàn toàn theo nút, không còn slash command riêng.

### `Add URL`
- mở modal để nhập link
- có thể thêm note/label

### `Add File`
- manager bấm `Add File` trong `Edit Task`
- bot sẽ “arm” 1 phiên upload trong 10 phút
- sau đó manager chỉ cần gửi message có file trong:
  - task workspace thread, hoặc
  - dashboard channel
- nếu message có text kèm theo, text đó được lưu làm note/label cho attachment
- sau khi file đã lưu, panel hiện tại sẽ được refresh lại để thấy attachment mới

### Chỉnh attachment hiện có
- mỗi attachment hiện có sẽ có 2 nút:
  - `⚙️` để edit
  - `✖️` để delete
- với file attachment: `⚙️` cho phép sửa note/label
- với link attachment: `⚙️` cho phép sửa URL và label

### `Remove Attachment`
- mở modal nhập attachment ID để gỡ

### Nguyên tắc tên file
- file attachment hiển thị ưu tiên theo `fileName`
- bot **không chủ động đổi tên file**
- bot **không chủ động bỏ dấu tiếng Việt**
- label/note là metadata riêng, không thay thế tên file gốc

---

## 4.6. Archive dùng để làm gì

`archive_channel` dùng để chứa **task card đã hoàn thành**.

### Nếu có cấu hình `archive_channel`
- task `DONE` sẽ được chuyển card sang `#task-archive`
- task thread sẽ được archive
- `#task-dashboard` chỉ giữ các task còn cần thao tác:
  - `BACKLOG`
  - `IN_PROGRESS`
  - `BLOCKED`
  - `REVIEW`

### Nếu không cấu hình `archive_channel`
- task `DONE` vẫn ở dashboard channel hiện tại
- thread vẫn được archive khi task hoàn thành

---

## 5. Setup Discord server như thế nào

## 5.1. Role nên có
Khuyến nghị role chuẩn:
- `Admin`
- `Technician`
- `Researcher`

### Ý nghĩa
- `Admin`: vận hành bot, setup, review, reload dashboard, edit task
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
- `#task-archive` *(optional nhưng nên có)*

### Category: THẢO LUẬN
- `#chung`

TaskBot dùng:
- `#task-dashboard` để post summary + task card đang active
- `#task-feed` để post sync report / lỗi vận hành
- `#task-archive` để giữ task card đã done
- workspace chính là **thread động** dưới task card, không cần tạo quá nhiều channel tĩnh

---

## 5.3. Quyền bot cần có
Bot nên được invite với scopes:
- `bot`
- `applications.commands`

Bot cần đủ quyền ở dashboard/feed/archive/thread:
- xem channel
- gửi tin nhắn
- xem lịch sử tin nhắn
- embed links
- attach files
- create public thread
- gửi tin nhắn trong thread
- manage threads

### Message Content Intent
Vì file upload giờ đi qua **message có attachment sau khi bấm nút `Add File`**, bot cần **Message Content Intent** trong Discord Developer Portal để đọc attachment + note text của message upload đó.

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
- `archive_channel` *(optional nhưng khuyến nghị có)*
- `admin_role`
- `secondary_manager_role` *(optional)*
- `reviewer_role` *(optional)*
- `secondary_reviewer_role` *(optional)*
- `max_active_tasks`
- `thread_auto_archive_minutes`

### Kết quả sau `/setup`
- bot lưu config vào DB
- bot luôn dùng giờ Việt Nam `GMT+7`
- bot luôn nhận deadline theo format `dd/MM/yyyy HH:mm`
- bot tạo/update summary dashboard
- summary dashboard sẽ có các nút:
  - `My Tasks`
  - `Review Queue`
  - `Create Task`
  - `Reload Dashboard`

---

## 6. Cách dùng hằng ngày

## 6.1. Manager
Manager thường làm các việc:
1. vào `#task-dashboard`
2. bấm `Create Task` để tạo task mới
3. sau khi tạo, bot mở ngay `Edit Task`
4. trong `Edit Task`:
   - bấm `Deadline` để nhập/sửa/xóa hạn chót
   - bấm `Link` để thêm attachment dạng URL
   - bấm `Add File` rồi upload file ở workspace/dashboard trong 10 phút
   - dùng `⚙️` để sửa attachment hiện có
   - dùng `✖️` để xóa attachment hiện có
4. mở task card -> bấm `Open Task` / `Progress` / `Review` / `Results`
5. nếu Discord state lệch, bấm `Reload Dashboard`

## 6.2. Contributor
Contributor thường làm các việc:
1. mở task card `BACKLOG`
2. bấm `Claim` nếu đúng role
3. nếu task đã active và còn slot, bấm `Join Task`
4. làm việc trong `Open Workspace`
5. khi đang làm:
   - nếu bạn là người làm task: bấm `Done` khi hoàn tất để chuyển sang `REVIEW`
   - nếu bạn chỉ là manager/admin: bạn sẽ thấy `Edit Task` và `Block`
   - nếu bạn vừa là người làm vừa là admin/manager: bạn vẫn thấy `Done`

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
5. kiểm tra quyền bot ở dashboard/feed/archive/thread
6. kiểm tra **Message Content Intent** đã bật chưa
7. chạy lại `/setup`
8. bấm `Reload Dashboard`

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

### Khi `Add File` không lưu được attachment
Thường do một trong các nguyên nhân sau:
- chưa bấm `Add File` trước khi upload
- upload quá thời gian 10 phút
- upload sai channel
- bot chưa có `Message Content Intent`
- bot thiếu quyền xem/gửi message ở thread/channel đó

### Deadline chuẩn hiện tại
- toàn bộ bot dùng **giờ Việt Nam (GMT+7)**
- nhập deadline theo đúng format: `dd/MM/yyyy HH:mm`
- ví dụ: `08/12/2026 00:00`

---

## 11. Giới hạn hiện tại

- backend hiện là SQLite, chưa phải DB multi-instance
- chỉ nên chạy **1 instance bot**
- chưa có Dockerfile chính thức
- chưa có backup automation
- chưa có CI/test suite hoàn chỉnh
- contributor claim/join vẫn phụ thuộc tên role Discord `Technician` và `Researcher`
- hiện chưa có UI chọn file native kiểu web; `Add File` dùng flow upload message sau khi bấm nút

---

## 12. License

`package.json` hiện để `UNLICENSED`.

Hãy coi repo này là private/internal cho tới khi bạn chủ động đổi license và chính sách phát hành.
