# Cài đặt và sử dụng bot

## 1. Mục tiêu

Tài liệu này hướng dẫn bạn:
- cài TaskBot local
- cấu hình `.env`
- register slash commands
- chạy bot
- setup bot trong Discord bằng `/setup`
- sử dụng workflow hằng ngày theo implementation hiện tại

Tài liệu này mô tả **code đang chạy thật**, không mô tả những command chỉ mới có trong spec.

---

## 2. TaskBot hiện hỗ trợ gì

### Slash commands
- `/ping`
- `/setup`
- `/task create`
- `/task sync-dashboard`

### Button workflow trên task card
- `Claim`
- `Join Task`
- `Block`
- `Unblock`
- `Done / Review`
- `Approve`
- `Request Changes`
- `Reopen`
- `Open Workspace`

### Mô hình task hiện tại
- task bắt đầu ở `Backlog`
- khi được claim sẽ sang `In Progress`
- task có thể `Blocked`
- khi hoàn thành thì được đưa sang `Review`
- sau khi approve sẽ sang `Done`
- mỗi task có thể có nhiều người trong team thông qua `team_size`
- workspace là **public thread** dưới channel dashboard

---

## 3. Điều kiện trước khi cài bot

Bạn nên có sẵn:
- Node.js `>=24.0.0`
- npm
- bot Discord đã được tạo
- bot đã được mời vào server với đủ scope/quyền
- server Discord đã tổ chức lại theo guide `01-discord-server-setup.md`
- file `.env` dựa trên `.env.example`

Bot nên được mời với scopes:
- `bot`
- `applications.commands`

Bot cần nhìn thấy và thao tác được ở:
- `#task-dashboard`
- `#task-feed`
- các public thread dưới dashboard

---

## 4. File môi trường `.env`

Tạo `.env` từ `.env.example`.

Ví dụ local:

```env
DISCORD_TOKEN=your_bot_token_here
CLIENT_ID=your_discord_application_id_here
DATABASE_URL=file:./dev.db
GUILD_ID=your_test_server_id_here
NODE_ENV=development
```

Ví dụ production:

```env
DISCORD_TOKEN=your_bot_token_here
CLIENT_ID=your_discord_application_id_here
DATABASE_URL=file:/opt/taskbot/data/taskbot.db
NODE_ENV=production
```

### Ý nghĩa từng biến

#### `DISCORD_TOKEN`
Token bot lấy từ Discord Developer Portal.

Dùng cho:
- chạy bot
- register slash commands

#### `CLIENT_ID`
Application ID / Client ID của Discord app.

Dùng cho:
- register slash commands

#### `DATABASE_URL`
Hiện tại bot dùng SQLite với Prisma.

Local mặc định:
```env
DATABASE_URL=file:./dev.db
```

Nếu deploy thật, nên dùng path nằm trên **persistent storage**.

#### `GUILD_ID`
Khuyến nghị dùng trong development.

Nếu có `GUILD_ID`:
- command được register theo guild
- cập nhật nhanh hơn nhiều khi test

Nếu không có `GUILD_ID`:
- command register global
- Discord có thể cập nhật chậm hơn

#### `NODE_ENV`
Giá trị hợp lệ:
- `development`
- `test`
- `production`

---

## 5. Các bước cài và chạy local

## Bước 1 — Cài dependency
```bash
npm install
```

## Bước 2 — Generate Prisma client
```bash
npm run prisma:generate
```

## Bước 3 — Chạy migration local
```bash
npm run prisma:migrate:dev
```

## Bước 4 — Register slash commands
```bash
npm run register:commands
```

## Bước 5 — Chạy bot local
```bash
npm run dev
```

Nếu thành công, log sẽ có dạng:
- `Starting TaskBot...`
- `Logged in as ...`

### Lưu ý PowerShell trên Windows
Nếu PowerShell chặn `npm.ps1`, dùng:

```powershell
npm.cmd run prisma:generate
npm.cmd run prisma:migrate:dev
npm.cmd run register:commands
npm.cmd run dev
```

---

## 6. Kiểm tra bot online

Chạy:
- `/ping`

Kết quả mong đợi:
- bot trả lời ephemeral với latency hiện tại

---

## 7. Setup bot trong Discord bằng `/setup`

Bạn phải chạy `/setup` trước khi workflow task hoạt động đúng.

### Ai được chạy `/setup`
Người chạy phải có Discord permission:
- `Manage Server` / `ManageGuild`

Lưu ý:
- role `Admin` trong bot **không thay thế** điều kiện này ở lần setup đầu tiên

### Ý nghĩa từng trường trong `/setup`

#### `dashboard_channel` *(bắt buộc)*
Channel dashboard chính.

Khuyến nghị:
- `#task-dashboard`

Bot sẽ dùng channel này để:
- đăng summary dashboard
- đăng task card
- tạo public thread cho task đang hoạt động

#### `feed_channel` *(bắt buộc)*
Channel log vận hành.

Khuyến nghị:
- `#task-feed`

Bot dùng để:
- đăng sync report
- đăng repair notice
- đăng cảnh báo vận hành

#### `admin_role` *(bắt buộc)*
Role quản lý chính của bot.

Theo mô hình chuẩn đang dùng:
- chọn role `Admin`

Role này được phép:
- tạo task
- override claim/join khi cần
- approve / request changes / reopen
- sync dashboard

#### `archive_channel` *(optional)*
Có thể để trống hoặc chọn `#task-archive`.

Lưu ý hiện tại:
- code chỉ lưu và hiển thị channel này trên summary
- bot chưa tự auto-post task done vào đó

#### `reviewer_role` *(optional)*
Có thể để trống.

Theo implementation hiện tại:
- `Admin` và `Technician` vẫn có thể thực hiện review actions
- nếu bạn đặt thêm `reviewer_role`, role đó cũng có thể review

#### `max_active_tasks` *(optional)*
Giới hạn số task active mỗi contributor.

#### `thread_auto_archive_minutes` *(optional)*
Thời gian auto-archive cho public thread workspace.

---

## 8. Tạo task bằng `/task create`

`/task create` hiện hỗ trợ:
- `title`
- `description`
- `required_role`
- `team_size`
- `priority`
- `deadline`

### Ai được tạo task
Theo implementation hiện tại:
- người có `Manage Server`
- người có role admin đã cấu hình
- `Technician`

### Ý nghĩa field quan trọng

#### `required_role`
Role chính được phép claim task đó:
- `ADMIN`
- `TECHNICIAN`
- `RESEARCHER`

#### `team_size`
Tổng số người task nên có.

Ví dụ:
- `1` → chỉ 1 người
- `2` → 1 người claim trước, người thứ hai có thể `Join Task`
- `3` → task có thể được nhiều người hỗ trợ hơn

#### `deadline`
Phải nhập ISO-8601 hợp lệ, ví dụ:
```text
2026-07-31T18:00:00+07:00
```

---

## 9. Task card hiện hiển thị gì

Mỗi task card hiện có thể hiển thị:
- `Status`
- `Role`
- `Priority`
- `Team`
- `Capacity`
- `Created by`
- `Deadline`
- `Workspace`
- `Blocked reason`

Workspace button nằm riêng để mở thread làm việc nhanh.

---

## 10. Workflow hằng ngày theo role

## 10.1. Workflow của Admin
Admin thường làm các việc:
1. chạy `/setup`
2. tạo task bằng `/task create`
3. theo dõi summary dashboard
4. can thiệp khi task bị block hoặc cần review
5. approve / request changes / reopen
6. chạy `/task sync-dashboard` khi Discord state bị lệch DB

## 10.2. Workflow của Technician
Technician có thể:
1. claim task `TECHNICIAN`
2. join task đang còn slot nếu đúng role
3. block / unblock / đưa task sang review nếu là thành viên task
4. hỗ trợ review/quản lý theo implementation hiện tại
5. hỗ trợ sync dashboard nếu có quyền workflow phù hợp trong code hiện tại

## 10.3. Workflow của Researcher
Researcher có thể:
1. claim task `RESEARCHER`
2. join task còn slot nếu đúng role
3. làm việc trong workspace thread
4. block / request review khi là thành viên task

---

## 11. Quy tắc claim và join

### Claim
Task `Backlog` có thể được `Claim` nếu:
- task chưa có team
- task chưa bị người khác claim
- người bấm có đúng contributor role
- hoặc là admin override
- chưa vượt `max_active_tasks` nếu không phải admin override

### Join Task
`Join Task` chỉ hiện khi:
- task ở `In Progress` hoặc `Blocked`
- task vẫn còn thiếu người theo `team_size`

Join sẽ fail nếu:
- task đã full
- user đã ở trong team
- task đổi state trước khi request hoàn tất
- user không có required role phù hợp

### Claim/join role hiện kiểm tra theo tên role
Tên role contributor hiện phải đúng tuyệt đối:
- `Technician`
- `Researcher`

---

## 12. Workflow trạng thái

### `Backlog`
Action chính:
- `Claim`

### `In Progress`
Action chính:
- `Join Task` *(nếu còn slot)*
- `Block`
- `Done / Review`

### `Blocked`
Action chính:
- `Join Task` *(nếu còn slot)*
- `Unblock`

### `Review`
Action chính:
- `Approve`
- `Request Changes`

### `Done`
Action chính:
- `Reopen`

---

## 13. Workspace thread

Khi task được claim thành công lần đầu:
- bot tạo public thread dưới dashboard
- thread name có dạng `TASK-001 — Tên task`
- team làm việc trong thread đó

Nếu thread tạo lỗi:
- task vẫn có thể đã đổi state trong DB
- sửa quyền bot ở dashboard/thread
- sau đó chạy `/task sync-dashboard`

---

## 14. `/task sync-dashboard` dùng khi nào

Dùng khi:
- summary bị mất
- task card bị mất
- workspace thread bị mất hoặc archive sai
- thread tạo lỗi sau claim
- Discord UI lệch khỏi DB

Bot sẽ cố:
- recreate summary
- recreate task card
- reopen/archive/recreate workspace thread
- đồng bộ lại state hiển thị từ database

---

## 15. Những gì chưa phải command thật ở thời điểm hiện tại

Các command sau **không phải slash command hiện có**, dù có thể xuất hiện trong spec cũ:
- `/task reassign`
- `/task list`
- `/task view`
- `/task reopen`
- `/task claim`
- `/task block`
- `/task unblock`
- `/task review`

Workflow hằng ngày hiện chủ yếu diễn ra qua **buttons trên task card**.

---

## 16. Checklist test nhanh

1. `/ping` hoạt động
2. `/setup` chạy thành công
3. tạo được task bằng `/task create`
4. claim được task đúng role
5. task có `team_size > 1` thì hiện `Join Task`
6. join đủ số người thì nút join biến mất
7. `Done / Review` đẩy task sang `Review`
8. `Approve` đẩy task sang `Done`
9. `Reopen` đưa task về `Backlog`
10. `/task sync-dashboard` repair được nếu xóa card hoặc summary

---

## 17. Tài liệu liên quan

- [Thiết lập Discord Server](01-discord-server-setup.md)
- [Hosting và vận hành](03-hosting-and-operations.md)
- [Xử lý sự cố và khôi phục](04-troubleshooting-and-recovery.md)