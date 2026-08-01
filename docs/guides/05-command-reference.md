# 05. Command reference

## 1. Mục tiêu

Tài liệu này tổng hợp **toàn bộ command và action hiện có của TaskBot** theo implementation hiện tại, bao gồm:
- command dùng để làm gì
- ai được phép dùng
- option quan trọng
- khi nào nên dùng
- giới hạn / lưu ý thực tế

Tài liệu này mô tả **code đang chạy trong repo**, không mô tả các ý tưởng chưa implement.

---

## 2. Tổng quan command surface

### Slash commands
- `/ping`
- `/setup`
- `/task create`
- `/task update-meta`
- `/task set-deadline`
- `/task clear-deadline`
- `/task add-attachment`
- `/task remove-attachment`
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

---

## 3. Quyền sử dụng nhanh

### Quyền cấp server Discord
#### `Manage Server` / `ManageGuild`
Dùng cho:
- chạy `/setup`
- luôn có quyền manager override trong bot

### Role manager cấu hình trong `/setup`
Dùng cho:
- tạo task
- sửa metadata task
- đặt/xóa deadline
- thêm/gỡ attachment
- sync dashboard
- review / approve / reopen theo workflow hiện tại

### Role reviewer cấu hình trong `/setup`
Dùng cho:
- `Approve`
- `Request Changes`
- `Reopen`

### Contributor / member task
Dùng cho:
- `Claim`
- `Join Task`
- `Block`
- `Unblock`
- `Done / Review`

Lưu ý:
- claim/join cho `TECHNICIAN` và `RESEARCHER` hiện vẫn phụ thuộc vào **tên role Discord** tương ứng.
- manager/reviewer roles là role cấu hình bằng `/setup`.

---

## 4. `/ping`

### Mục đích
Kiểm tra bot có online không.

### Ai dùng
Bất kỳ ai nhìn thấy bot command trong server.

### Kết quả
Bot trả lời ephemeral với gateway latency hiện tại.

### Khi nên dùng
- sau khi deploy
- sau khi restart PM2
- khi nghi bot đang treo hoặc mất kết nối

---

## 5. `/setup`

### Mục đích
Thiết lập TaskBot cho một server Discord cụ thể.

### Ai dùng
Chỉ người có quyền Discord:
- `Manage Server` / `ManageGuild`

### Dùng để cấu hình gì
- dashboard channel
- feed channel
- archive channel
- manager roles
- reviewer roles
- giới hạn active task mỗi contributor
- thread auto-archive mặc định
- timezone mặc định cho deadline
- cách nhập deadline mặc định

### Các option

#### `dashboard_channel` *(bắt buộc)*
Channel chính để bot:
- post dashboard summary
- post task card
- tạo public workspace thread

#### `feed_channel` *(bắt buộc)*
Channel cho thông báo vận hành như:
- repair notice
- sync report
- lỗi tạo thread
- các cảnh báo phục hồi

#### `admin_role` *(bắt buộc)*
Role manager chính của bot.

#### `secondary_manager_role` *(optional)*
Role manager phụ.

#### `archive_channel` *(optional)*
Channel archive hiển thị trong cấu hình dashboard.

Lưu ý hiện tại:
- bot **chưa tự động post task done** vào archive channel
- channel này chủ yếu là metadata cấu hình cho vận hành sau này

#### `reviewer_role` *(optional)*
Role reviewer chính.

#### `secondary_reviewer_role` *(optional)*
Role reviewer phụ.

#### `max_active_tasks` *(optional)*
Giới hạn số task active mỗi contributor.

#### `thread_auto_archive_minutes` *(optional)*
Thiết lập inactivity auto-archive cho public workspace thread.

Giá trị hiện hỗ trợ:
- `60` phút
- `1440` phút
- `4320` phút
- `10080` phút

#### `default_timezone` *(optional)*
Timezone mặc định khi nhập deadline **không có offset**.

Mặc định hiện tại:
- `Asia/Ho_Chi_Minh`

#### `default_date_input_mode` *(optional)*
Cách nhập deadline mặc định cho guild.

Giá trị hiện hỗ trợ:
- `Vietnam + ISO`
- `Vietnam only`
- `ISO only`

### Kết quả khi setup thành công
- bot lưu config vào DB
- bot tạo hoặc update dashboard summary message
- summary hiển thị manager/reviewer roles thật, không hardcode giả

### Khi nên chạy lại `/setup`
- đổi channel dashboard/feed/archive
- đổi manager/reviewer roles
- đổi timezone hoặc deadline input mode
- đổi max active tasks
- đổi thread auto-archive mặc định

---

## 6. `/task create`

### Mục đích
Tạo một task mới ở trạng thái `Backlog`.

### Ai dùng
- server manager (`ManageGuild`)
- hoặc configured manager roles

### Các option

#### `title` *(bắt buộc)*
Tiêu đề ngắn của task.

#### `description` *(bắt buộc)*
Mô tả đầy đủ của task.

#### `required_role` *(bắt buộc)*
Role nghiệp vụ để claim task:
- `ADMIN`
- `TECHNICIAN`
- `RESEARCHER`

#### `team_size` *(optional)*
Số lượng người tối đa của task.

#### `priority` *(optional)*
Mức ưu tiên:
- `LOW`
- `MEDIUM`
- `HIGH`
- `URGENT`

#### `deadline` *(optional)*
Deadline của task.

Hỗ trợ:
- `dd/MM/yyyy HH:mm`
- ISO-8601

Ví dụ:
- `31/08/2026 18:00`
- `2026-08-31T18:00:00+07:00`

Nếu input không có offset:
- bot hiểu theo `default_timezone` của guild

### Kết quả
- tạo record task trong DB
- post task card lên dashboard
- refresh summary

---

## 7. `/task update-meta`

### Mục đích
Cho manager sửa metadata hiện có của task mà không cần tạo lại task.

### Ai dùng
- server manager (`ManageGuild`)
- hoặc configured manager roles

### Các field có thể sửa
- `title`
- `description`
- `required_role`
- `priority`
- `team_size`

### Option
#### `task_code` *(bắt buộc)*
Ví dụ:
- `TASK-001`

#### `title` *(optional)*
Tiêu đề mới.

#### `description` *(optional)*
Mô tả mới.

#### `required_role` *(optional)*
Role mới của task.

#### `priority` *(optional)*
Priority mới.

#### `team_size` *(optional)*
Team size mới.

### Lưu ý
- phải truyền ít nhất 1 field để sửa
- `team_size` không được nhỏ hơn số member hiện tại đang có trong task
- sau khi sửa, task card và dashboard summary sẽ tự refresh

### Khi nên dùng
- task viết quá ngắn / thiếu context
- cần đổi `required_role`
- cần tăng team size
- cần chỉnh lại priority

---

## 8. `/task set-deadline`

### Mục đích
Đặt mới hoặc thay deadline hiện tại của task.

### Ai dùng
- server manager (`ManageGuild`)
- hoặc configured manager roles

### Option
#### `task_code` *(bắt buộc)*
Ví dụ:
- `TASK-001`

#### `deadline` *(bắt buộc)*
Hỗ trợ:
- `dd/MM/yyyy HH:mm`
- ISO-8601

Ví dụ:
- `31/08/2026 18:00`
- `2026-08-31T18:00:00+07:00`

### Kết quả
- update `deadlineAt` trong DB
- tạo task event audit
- refresh task card và summary

### Lưu ý
- command này **không đổi auto-archive rule của thread**
- deadline chỉ dùng cho hiển thị, overdue state, và DM reminder riêng tư

---

## 9. `/task clear-deadline`

### Mục đích
Xóa deadline khỏi task.

### Ai dùng
- server manager (`ManageGuild`)
- hoặc configured manager roles

### Option
#### `task_code` *(bắt buộc)*
Ví dụ:
- `TASK-001`

### Khi nên dùng
- task không cần deadline nữa
- deadline cũ không còn hợp lệ
- muốn bỏ reminder tự động theo deadline

### Kết quả
- `deadlineAt` về `null`
- refresh task card / summary

---

## 10. `/task add-attachment`

### Mục đích
Gắn thêm tài liệu tham chiếu vào task.

### Ai dùng
- server manager (`ManageGuild`)
- hoặc configured manager roles

### Hỗ trợ kiểu attachment
- file upload Discord
- URL tham chiếu

### Option
#### `task_code` *(bắt buộc)*
Ví dụ:
- `TASK-001`

#### `file` *(optional)*
File Discord upload.

#### `url` *(optional)*
Link tài liệu / website / repo / docs.

#### `label` *(optional)*
Tên ngắn dễ đọc cho attachment.

### Rule
- phải có **ít nhất 1 trong 2**: `file` hoặc `url`
- không dùng đồng thời cả `file` và `url` trong cùng một lần gọi

### Kết quả
- lưu attachment vào DB
- task card hiển thị danh sách attachment cùng `attachment_id`

### Khi nên dùng
- gắn repo GitHub
- gắn docs / design / PDF / ảnh mẫu
- bổ sung context cho task đang thiếu tài liệu

---

## 11. `/task remove-attachment`

### Mục đích
Gỡ attachment khỏi task.

### Ai dùng
- server manager (`ManageGuild`)
- hoặc configured manager roles

### Option
#### `task_code` *(bắt buộc)*
Ví dụ:
- `TASK-001`

#### `attachment_id` *(bắt buộc)*
ID attachment hiển thị ngay trên task card.

### Kết quả
- xóa attachment khỏi DB
- refresh task card và summary

---

## 12. `/task sync-dashboard`

### Mục đích
Repair dashboard khi state Discord bị lệch so với DB.

### Ai dùng
- server manager (`ManageGuild`)
- hoặc configured manager roles

### Option
#### `task_code` *(optional)*
Nếu có truyền:
- chỉ repair task đó

Nếu bỏ trống:
- repair toàn bộ dashboard

### Nó sẽ cố gắng làm gì
- refresh summary
- recreate task card bị mất
- repair thread reference
- recreate workspace thread nếu cần
- reopen thread active bị archive nhầm
- archive thread `Done` còn đang mở

### Khi nên dùng
- task card bị xóa tay
- summary không khớp DB
- thread bị mất / bị archive sai
- bot fail giữa chừng và Discord state bị lệch

---

## 13. Button workflow trên task card

### `Claim`
#### Mục đích
Người phù hợp nhận task từ `Backlog`.

#### Kết quả
- task sang `In Progress`
- gán `assigneeDiscordUserId`
- tạo workspace thread nếu chưa có

---

### `Join Task`
#### Mục đích
Thêm member vào task đang active khi còn slot.

#### Kết quả
- thêm `TaskMember`
- dùng cho team task model

---

### `Block`
#### Mục đích
Đánh dấu task bị chặn.

#### Ai dùng
- configured manager role
- hoặc member của chính task

#### Kết quả
- mở modal nhập lý do
- task sang `Blocked`

---

### `Unblock`
#### Mục đích
Bỏ trạng thái blocked.

#### Ai dùng
- configured manager role
- hoặc member của chính task

#### Kết quả
- task về `In Progress`

---

### `Done / Review`
#### Mục đích
Chuyển task từ `In Progress` sang `Review`.

#### Ai dùng
- configured manager role
- hoặc member của chính task

#### Kết quả
- task sang `Review`
- bot hiển thị ai là reviewer theo config hiện tại

---

### `Approve`
#### Mục đích
Duyệt task hoàn thành.

#### Ai dùng
- configured manager role
- configured reviewer role
- server manager override

#### Kết quả
- task sang `Done`
- archive workspace thread

---

### `Request Changes`
#### Mục đích
Trả task từ `Review` về `In Progress`.

#### Ai dùng
- configured manager role
- configured reviewer role
- server manager override

---

### `Reopen`
#### Mục đích
Mở lại task đã `Done`.

#### Ai dùng
- configured manager role
- configured reviewer role
- server manager override

#### Kết quả
- task về `Backlog`
- clear assignee và team members

---

### `Open Workspace`
#### Mục đích
Mở thread làm việc của task.

#### Khi xuất hiện
- task có `threadChannelId`

---

## 14. Reminder deadline riêng tư

### Cách hoạt động hiện tại
- bot kiểm tra các task active có deadline
- bot gửi **DM riêng cho assignee**
- có lưu receipt để tránh gửi trùng mỗi ngày

### Reminder này không làm gì
- không post công khai trong thread
- không auto archive thread khi quá hạn
- không tự đổi status task

---

## 15. Giới hạn hiện tại cần biết

- `archive_channel` mới là metadata/config; bot chưa auto-post task done vào đó
- claim/join `TECHNICIAN` và `RESEARCHER` vẫn phụ thuộc **tên role Discord**
- reminder deadline hiện gửi theo DM cho assignee, không phải ephemeral scheduled message
- thread auto-archive vẫn là rule riêng theo inactivity setting, không bị deadline override

---

## 16. Gợi ý dùng command theo tình huống

### Khi bot mới lên server
1. `/ping`
2. `/setup`
3. `/task create`

### Khi task thiếu nội dung / cần sửa lại
1. `/task update-meta`
2. `/task add-attachment`
3. `/task set-deadline`

### Khi Discord bị lệch trạng thái
1. `/task sync-dashboard`

### Khi task không còn cần deadline
1. `/task clear-deadline`

---

## 17. Lệnh manager hay dùng nhất

Nếu bạn là manager, bộ command dùng nhiều nhất thường là:
- `/setup`
- `/task create`
- `/task update-meta`
- `/task set-deadline`
- `/task add-attachment`
- `/task sync-dashboard`

---

## 18. Tài liệu liên quan
- `01-discord-server-setup.md`
- `02-bot-setup-and-daily-use.md`
- `03-hosting-and-operations.md`
- `04-troubleshooting-and-recovery.md`
