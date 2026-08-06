# TaskBot

TaskBot là bot quản lý công việc chạy trực tiếp trong Discord cho nhóm nhỏ và vừa.

Thay vì web dashboard riêng, TaskBot dùng chính Discord làm giao diện vận hành:

- 1 **dashboard summary** trong `#task-dashboard`
- 1 **task card** cho mỗi task
- 1 **public workspace thread** cho mỗi task đang hoạt động
- SQLite/Prisma làm **source of truth**
- các thao tác hằng ngày đi qua **buttons + modal + panel ephemeral/private**

---

## Quick start: từ đầu đến lúc chạy `/setup`

Nếu bạn chỉ cần đưa bot lên chạy và vào được bước `/setup`, làm theo đúng thứ tự này.

### Bước 1: Tạo Discord application + bot

1. Vào Discord Developer Portal.
2. Tạo application mới.
3. Tạo bot và lấy `DISCORD_TOKEN`.
4. Lấy `CLIENT_ID` của application.
5. Invite bot vào server với scopes:
   - `bot`
   - `applications.commands`

### Bước 2: Chuẩn bị Discord server

Tạo role khuyến nghị:

- `Admin`
- `Technician`
- `Researcher`

Tạo channel khuyến nghị:

- `#task-dashboard`
- `#task-feed`
- `#task-archive` *(optional nhưng nên có)*

> Logic claim/join hiện tại đang kiểm tra đúng tên role `Technician` và `Researcher`, nên chưa nên đổi hai tên này nếu chưa sửa code.

### Bước 3: Clone repo và mở terminal đúng thư mục

Tất cả lệnh `npm`, `prisma`, `pm2` bên dưới đều phải chạy **bên trong folder repo TaskBot**.

Nếu chưa clone repo:

```bash
git clone <repo-url>
cd TaskBot
```

Nếu đã có source code sẵn trên máy, chỉ cần đi vào đúng folder repo:

```bash
cd /duong-dan/toi/TaskBot
```

Ví dụ trên Linux server:

```bash
cd ~/TaskBot
```

Ví dụ trên Windows PowerShell:

```powershell
cd "D:\Data\Learning\University\Project thư viện\TaskBot"
```

### Bước 4: Chuẩn bị file `.env`

Copy `.env.example` thành `.env`, rồi điền giá trị thật:

```env
DISCORD_TOKEN=your_bot_token_here
CLIENT_ID=your_discord_application_id_here
DATABASE_URL=file:./dev.db
GUILD_ID=your_server_id_here
NODE_ENV=development
```

Ghi chú:

- File `.env` nên nằm ngay trong folder repo `TaskBot`.
- `GUILD_ID` là optional trong code, nhưng nên có khi dev hoặc khi deploy cho 1 server để slash command cập nhật nhanh hơn.
- Nếu chạy production với SQLite persistent, đổi `DATABASE_URL` sang path tuyệt đối, ví dụ `file:/opt/taskbot/data/taskbot.db`.

### Bước 5: Cài dependency và database

Sau khi đã `cd` vào repo, chạy lần lượt:

```bash
npm install
npm run prisma:generate
npm run prisma:migrate:dev
```

### Bước 6: Register slash commands

Vẫn trong folder repo, chạy:

```bash
npm run register:commands
```

Ghi chú:

- Nếu đang ở bash/Linux, dùng `npm`.
- Chỉ dùng `npm.cmd` khi đang ở Windows PowerShell/CMD và bị chặn `npm.ps1`.

### Bước 7: Chạy bot

Vẫn trong folder repo:

Nếu chạy local:

```bash
npm run dev
```

Nếu chạy production:

```bash
npm run build
npm run start
```

### Bước 8: Kiểm tra bot và chạy `/setup`

Trong Discord:

1. chạy `/ping`
2. nếu bot phản hồi, chạy `/setup`
3. điền các field cần thiết:
   - `dashboard_channel`
   - `feed_channel`
   - `archive_channel` *(optional)*
   - `admin_role`
   - các role optional khác nếu cần

Sau `/setup`, bot sẽ lưu config vào DB và tạo hoặc cập nhật summary dashboard trong `#task-dashboard`.

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
- toàn bộ deadline mặc định theo giờ Việt Nam `GMT+7`
- toàn bộ input deadline dùng format `dd/MM/yyyy HH:mm`
- contributor claim/join hiện vẫn phụ thuộc tên role Discord:
  - `Technician`
  - `Researcher`

---

## 3. Command surface hiện tại

TaskBot hiện giữ:

| Command                  | Mục đích                                                                              | Ai dùng                     |
| ------------------------ | ---------------------------------------------------------------------------------------- | ---------------------------- |
| `/ping`                | kiểm tra bot còn online không                                                         | mọi người                 |
| `/setup`               | cấu hình bot cho server                                                                | người có`Manage Server` |
| `/task add-attachment` | upload file trực tiếp hoặc thêm URL vào task bằng attachment field / input Discord | manager/admin                |

### Ghi chú về `/task add-attachment`

- dùng khi đang ở flow `Attachments`
- `task_code` hiện nhận **số thứ tự task theo guild**, ví dụ `42` hoặc `Task #0042` *(giữ tên option cũ để tương thích, nhưng ý nghĩa giờ là task number)*
- autocomplete sẽ hiển thị kiểu `Task #0042 • Tên task`, nhưng vẫn có thể **tự nhập tay**
- nếu upload file, Discord sẽ mở đúng ô chọn file native như trước
- nếu không upload file, có thể nhập `url`
- bot vẫn giữ **tên file gốc đúng như Discord gửi vào**

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

- Title
- Description
- Team Size

> Modal tạo task giờ được giữ gọn để giảm nhập tay. Sau khi tạo xong, bot sẽ mở ngay editor để chọn `Required Role`, `Priority`, và `Deadline` bằng control trực quan hơn.

### Bước 2: Edit Task ngay sau khi tạo

Sau khi tạo xong, bot sẽ:

1. Tạo task thật ngay lập tức
2. Đồng bộ public task card vào dashboard
3. Mở private editor để manager tinh chỉnh tiếp

Trong editor này sẽ có:

- Dropdown `Required Role`
- Dropdown `Priority`
- Dropdown `Deadline Preset`
- `Custom Deadline`
- `Edit Details`
- `Attachments`
- `Overview`
- `Done`

> `Done` ở màn hình ngay sau khi tạo chỉ có nghĩa là đóng editor sau khi tinh chỉnh xong. Nó **không** hủy task vừa tạo.

### Mặc định an toàn lúc vừa tạo

Để tránh task bị claim sai trước khi manager chỉnh xong:

- `Required Role` mặc định là `RESEARCHER`
- `Priority` mặc định là `MEDIUM`
- `Deadline` mặc định là chưa đặt

Manager nên chọn lại role/priority/deadline ngay trong editor trước khi giao task cho contributor.

Các hướng dẫn tiếp theo sẽ nằm **trong editor/private panel**. Public task card là kết quả tạo task chính; private editor chỉ là bước tinh chỉnh tiếp theo. Khi mở panel mới, bot sẽ cố thay panel private trước đó thay vì để nhiều cửa sổ trôi cùng lúc.

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

- Contributor đủ role có thể `Claim`
- Manager có nút `Edit Task`
- Trong `Edit Task` sẽ có:
  - Dropdown `Required Role`
  - Dropdown `Priority`
  - Dropdown `Deadline Preset`
  - `Custom Deadline`
  - `Edit Details`
  - `Attachments`
  - `Overview`
  - `Delete Task`
  - `Exit`

### `IN_PROGRESS`

- Người làm task sẽ thấy nút `Done`
- Manager/admin sẽ thấy:
  - `Edit Task`
  - `Block`
- Nếu một người **vừa là task member vừa là admin/manager**, họ vẫn sẽ thấy `Done` vì họ là người làm task
- Người khác nếu đủ role và còn slot có thể `Join Task`
- Khi người làm bấm `Done`, task chuyển sang `REVIEW`

### `BLOCKED`

- Task member / manager có thể `Unblock`
- Manager vẫn có `Edit Task`

### `REVIEW`

- Reviewer / manager có thể:
  - `Approve`
  - `Request Changes`
- Manager vẫn có `Edit Task` nếu cần chỉnh metadata/deadline/attachment
- Trạng thái này xuất hiện sau khi người làm bấm `Done`
- Nếu người đó cũng là admin/reviewer thì lúc này họ sẽ thấy `Approve`

### `DONE`

- Reviewer / manager có thể `Reopen`
- Nếu có `archive_channel`, task card completed sẽ được chuyển sang archive channel

### Tối ưu nút

Bot sẽ cố cập nhật lại:

- **public task card** nếu state đổi
- **private panel của người vừa bấm**
- **summary dashboard**

Ngoài ra, các panel chính đều nên có `Exit` để đỡ rườm rà khi mở nhiều bảng.

---

## 4.5. Attachment flow

Attachment không còn rải ra thành nhiều nút ở editor chính nữa.

### Trong `Edit Task`

- Bấm `Attachments`
- Bot mở panel attachment riêng

### Panel `Attachments`

Panel này sẽ:

- Hiển thị danh sách attachment hiện tại bằng **tên file/link dễ đọc**
- Có nút hướng dẫn:
  - `Upload File`
  - `Add URL`
- Khi bấm `Upload File` hoặc `Add URL`, bot sẽ hiện **lệnh slash có sẵn để copy nhanh** cho đúng task hiện tại
- Có action theo từng attachment:
  - file upload: `Delete ...`
  - link attachment: `Edit ...`, `Delete ...`
- Có:
  - `Back`
  - `Exit`

### Upload File như trước

Khi cần upload file trực tiếp kiểu cũ:

- Dùng `/task add-attachment`
- Chọn task từ list suggestion hoặc tự nhập số task như `42` / `Task #0042`
- Nếu bấm nút `Upload File`, bot sẽ đưa ra một lệnh slash sẵn để copy nhanh theo kiểu:
  - `/task add-attachment task_code:Task #0042 • Ten task file:`
- Upload file trực tiếp vào attachment field của command
- Có thể thêm note/label nếu muốn

### Add URL

- Cũng dùng `/task add-attachment`
- Không upload file
- Điền `url`
- Có thể thêm `label`

### Chỉnh attachment hiện có

- Trong panel `Attachments`, mỗi attachment sẽ có action theo đúng loại của nó
- Với file attachment:
  - chỉ có `Delete`
  - nếu muốn thay file, upload file mới rồi xóa file cũ
- Với link attachment:
  - có `Edit`
  - có `Delete`
  - `Edit` cho phép sửa URL và label

### Nguyên tắc tên file

- File attachment hiển thị ưu tiên theo `fileName`
- Bot **không chủ động đổi tên file**
- Bot **không chủ động bỏ dấu tiếng Việt**
- Trong private panel/editor, bot ưu tiên hiện **tên file gốc** để tránh cảm giác bị rename
- Label/note là metadata riêng, không thay thế tên file gốc

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

- Bot lưu config vào DB
- Bot luôn dùng giờ Việt Nam `GMT+7`
- Bot luôn nhận deadline theo format `dd/MM/yyyy HH:mm`
- Bot tạo/update summary dashboard
- Summary dashboard sẽ có các nút:
  - `My Tasks`
  - `Review Queue`
  - `Create Task`
  - `Reload Dashboard`

---

## 6. Cách dùng hằng ngày

## 6.1. Manager

Manager thường làm các việc:

1. Vào `#task-dashboard`
2. Bấm `Create Task` để tạo task mới
3. Sau khi tạo, bot mở ngay `Edit Task`
4. Trong `Edit Task`:
   - Chọn `Required Role` bằng dropdown
   - Chọn `Priority` bằng dropdown
   - Chọn `Deadline Preset` hoặc bấm `Custom Deadline` để nhập giờ chính xác
   - Bấm `Edit Details` nếu cần sửa title/description/team size
   - Bấm `Attachments` để mở panel attachment
   - Từ đó dùng `/task add-attachment` nếu cần upload file hoặc thêm URL
   - Dùng action `Edit` / `Delete` theo đúng loại attachment hiện có
   - Bấm `Delete Task` nếu manager muốn xóa hẳn task khỏi bot
   - Bấm `Done` khi đã tinh chỉnh xong màn hình hậu tạo task đầu tiên
5. Mở task card -> bấm `Open Task` / `Progress` / `Review` / `Results`
6. Nếu Discord state lệch, bấm `Reload Dashboard`

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

0. Mở terminal và đi vào đúng folder repo:

   ```bash
   cd /duong-dan/toi/TaskBot
   ```

   Ví dụ Linux:

   ```bash
   cd ~/TaskBot
   ```

   Ví dụ Windows PowerShell:

   ```powershell
   cd "D:\Data\Learning\University\Project thư viện\TaskBot"
   ```
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
   - test `/task add-attachment`

Nếu PowerShell chặn `npm.ps1`, dùng `npm.cmd` thay cho `npm` **trên Windows PowerShell/CMD**. Nếu đang ở bash/Linux thì vẫn dùng `npm` bình thường.

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

1. Clone source code lên host:

   ```bash
   git clone <repo-url>
   ```
2. Đi vào đúng folder repo:

   ```bash
   cd TaskBot
   ```

   Ví dụ nếu repo đã nằm sẵn ở home:

   ```bash
   cd ~/TaskBot
   ```
3. Tạo `.env` trong chính folder repo.
4. Cài dependency sạch:

   ```bash
   npm ci
   ```
5. Validate Prisma schema:

   ```bash
   npm run prisma:validate
   ```
6. Generate Prisma client:

   ```bash
   npm run prisma:generate
   ```
7. Chạy migration production:

   ```bash
   npm run prisma:migrate:deploy
   ```
8. Register slash commands:

   ```bash
   npm run register:commands
   ```
9. Build app:

   ```bash
   npm run build
   ```
10. Start bot:

```bash
   npm run start
```

### PM2

Các lệnh này cũng phải chạy trong folder repo hoặc sau khi process `taskbot` đã được tạo đúng từ repo đó.

### Khởi động lần đầu bằng PM2

```bash
cd ~/TaskBot
pm2 delete taskbot || true
npm ci
npm run prisma:generate
npm run prisma:migrate:deploy
npm run register:commands
npm run build
pm2 start npm --name taskbot -- run start
pm2 save
pm2 status
```

### Cập nhật code rồi restart lại

```bash
cd ~/TaskBot
npm run prisma:migrate:deploy
npm run register:commands
npm run build
pm2 restart taskbot || pm2 start npm --name taskbot -- run start
pm2 save
pm2 status
```

### Xem log / trạng thái

```bash
pm2 logs taskbot
pm2 show taskbot
pm2 status
```

### Tự khởi động lại sau khi reboot server

```bash
pm2 startup
pm2 save
```

> Sau khi chạy `pm2 startup`, PM2 sẽ in ra thêm một lệnh hệ thống. Hãy copy chạy đúng lệnh đó rồi mới `pm2 save` lại.

---

## 9. Scripts chính

| Script                            | Mục đích                  |
| --------------------------------- | ---------------------------- |
| `npm run dev`                   | chạy bot ở watch mode      |
| `npm run build`                 | build TypeScript ra`dist/` |
| `npm run start`                 | chạy bản build production  |
| `npm run typecheck`             | kiểm tra TypeScript         |
| `npm run clean`                 | xóa`dist/`                |
| `npm run register:commands`     | register slash commands      |
| `npm run prisma:generate`       | generate Prisma client       |
| `npm run prisma:validate`       | validate Prisma schema       |
| `npm run prisma:migrate:dev`    | migration local              |
| `npm run prisma:migrate:deploy` | migration production         |

---

## 10. Troubleshooting nhanh

Nếu bot có vấn đề, kiểm tra theo thứ tự:

1. test `/ping`
2. kiểm tra log `Logged in as ...`
3. kiểm tra `.env`
4. kiểm tra command đã register chưa
5. kiểm tra quyền bot ở dashboard/feed/archive/thread
6. chạy lại `/setup`
7. bấm `Reload Dashboard`

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

### Khi upload attachment không hoạt động như mong đợi

Kiểm tra:

- đã dùng đúng `/task add-attachment`
- đã chọn đúng `task_code` hoặc nhập đúng số task, ví dụ `42` / `Task #0042`
- nếu upload file: có chọn đúng attachment field chưa
- nếu thêm link: có nhập đúng `url` chưa
- bot có quyền attach files / send messages ở server đó không

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
- upload file trực tiếp vẫn phụ thuộc vào Discord slash attachment field, không thể nhúng file picker native vào button/modal

---

## 12. License

Repo hiện dùng **MIT License**.

Các file liên quan:

- `package.json` = `MIT`
- file `LICENSE` ở root repo

Điều này cho phép người khác dùng, sửa, phân phối lại source khá thoáng, miễn là giữ lại copyright notice và phần license đi kèm.
