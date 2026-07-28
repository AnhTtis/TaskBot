# Thiết lập Discord Server

## 1. Mục tiêu

Tài liệu này hướng dẫn bạn tổ chức lại Discord server để TaskBot hoạt động ổn định, rõ vai trò, dễ vận hành, và dễ mở rộng về sau.

Bản chuẩn trong tài liệu này dùng đúng **3 role**:
- `Admin`
- `Technician`
- `Researcher`

Với bộ setup chuẩn này:
- **không dùng** role `Reviewer`
- khi chạy `/setup`, trường `reviewer_role` sẽ để trống
- `Admin` là người review, approve, return, reopen

---

## 2. Cấu trúc server đề xuất

TaskBot phù hợp với mô hình hiện đại của Discord team workspace:
- ít channel tĩnh
- nhiều thread động
- 1 dashboard trung tâm
- mỗi task có 1 thread làm việc riêng

## 2.1. Cấu trúc khuyến nghị

### 📁 THÔNG TIN
- `#chao-mung-va-noi-quy`
- `#thong-bao`
- `#tai-nguyen`

### 📁 TASKBOT
- `#task-dashboard`
- `#task-feed`
- `#daily-check-in`
- `#task-archive` *(optional)*

### 📁 THẢO LUẬN
- `#chung`

### 📁 QUẢN TRỊ
- `#admin-dieu-phoi`

### 📁 PHÒNG THOẠI
- `🔊 Phòng chờ`
- `🔊 Họp nhanh`
- `🔊 Họp nhóm`

## 2.2. Mapping từ cấu trúc cũ sang cấu trúc mới

| Cấu trúc cũ | Nên đổi thành | Ghi chú |
|---|---|---|
| `#chào-mừng-và-nội-quy` | `#chao-mung-va-noi-quy` | Có thể giữ tên có dấu nếu bạn muốn |
| `#thông-báo` | `#thong-bao` | Chỉ Admin đăng |
| `#tài-nguyên` | `#tai-nguyen` | Kênh tài liệu và link hữu ích |
| `#bảng-công-việc` | `#task-dashboard` | Dashboard trung tâm của bot |
| `#checking-hang-ngay` | `#daily-check-in` | Tên rõ nghĩa hơn |
| `#trang-thai-task` | Bỏ | Status nằm trên task card |
| `#task-done` | Bỏ hoặc đổi thành `#task-archive` | Hiện bot chưa tự post done vào đây |
| `Chat-Chit/#chung` | `THẢO LUẬN/#chung` | Giữ được |
| `KHU VỰC LÀM VIỆC` | Không cần channel con | TaskBot dùng thread động |
| `Phòng Họp 1/2` | `Họp nhanh/Họp nhóm` | Tên thực tế hơn |

---

## 3. Vai trò chuẩn hóa

## 3.1. `Admin`
Role vận hành TaskBot.

Người có role này sẽ:
- chạy `/setup`
- tạo task bằng `/task create`
- override claim khi cần
- approve / return / reopen
- chạy `/task sync-dashboard`
- xử lý quyền, kênh, thread, và lỗi vận hành

## 3.2. `Technician`
Role contributor cho task kỹ thuật.

**Quan trọng:** current code kiểm tra đúng tên role là `Technician` khi claim task có `required_role = TECHNICIAN`.

## 3.3. `Researcher`
Role contributor cho task nghiên cứu.

**Quan trọng:** current code kiểm tra đúng tên role là `Researcher` khi claim task có `required_role = RESEARCHER`.

## 3.4. Thứ tự role khuyến nghị

Trong danh sách role Discord, nên sắp như sau:
1. `Admin`
2. `Technician`
3. `Researcher`
4. bot role của TaskBot

Gợi ý thực tế:
- bot role nên đặt đủ cao để thao tác thread/message thuận lợi
- nhưng **không cần** quyền `Người Quản Lý`

---

## 4. Nguyên tắc phân quyền

Mục tiêu thiết kế quyền:
- `Admin` đủ quyền vận hành nhưng không lạm dụng `Administrator`
- `Technician` và `Researcher` đủ quyền làm việc với dashboard + thread
- bot đủ quyền gửi message, đọc lịch sử, tạo thread, quản lý thread
- `@everyone` chỉ có quyền tối thiểu

### Quy tắc vàng
- ưu tiên **least privilege**
- không cho contributor quyền quản trị kênh/tin nhắn/thread
- giữ `#task-dashboard` là kênh workflow, không phải kênh chat tự do
- thảo luận task đi trong thread, không đẩy sang quá nhiều channel rời rạc

---

## 5. Quyền tổng quát ở cấp role (server-level)

Đây là bộ quyền nền trước khi bạn tinh chỉnh theo từng category/channel.

## 5.1. Role `Admin`

### Nên BẬT
#### ⚙️ Quyền Tổng Quát Máy Chủ
- `Xem Các Kênh`
- `Quản Lý Kênh`
- `Quản Lý Vai Trò` *(nếu người này thật sự quản trị server)*
- `Xem Nhật Ký Chỉnh Sửa`
- `Quản lý Webhook` *(optional)*
- `Quản lý phòng` *(nếu là admin server thật sự)*

#### 👤 Quyền Thành Viên
- `Tạo Lời Mời` *(optional)*
- `Đổi Biệt Danh`
- `Quản Lý Biệt Danh` *(optional)*
- `Hạn chế thành viên` *(optional)*

#### 💬 Quyền Kênh Tin Nhắn
- `Gửi tin nhắn và tạo bài đăng`
- `Gửi tin nhắn trong chủ đề và bài đăng`
- `Tạo Chủ Đề Công Khai`
- `Nhúng liên kết`
- `Đính kèm tập tin`
- `Thêm Biểu Cảm`
- `Dùng Emoji Mở Rộng` *(optional)*
- `Dùng Sticker Mở Rộng` *(optional)*
- `Quản lý tin nhắn`
- `Ghim Tin Nhắn`
- `Bỏ Qua Chế Độ Chậm`
- `Quản lý chủ đề và bài đăng`
- `Xem lịch sử tin nhắn`
- `Tạo khảo sát` *(optional)*

#### 🎙️ Quyền Kênh Thoại
- `Kết nối`
- `Nói`
- `Video`
- `Sử dụng chế độ tự động nhận diện giọng nói`
- `Tắt âm thành viên` *(optional)*
- `Tắt nghe thành viên` *(optional)*
- `Di chuyển thành viên` *(optional)*
- `Đặt trạng thái Kênh Thoại` *(optional)*

#### 🤖 Quyền Ứng Dụng
- `Sử Dụng Câu Lệnh Ứng Dụng`
- `Sử dụng Hoạt động` *(optional)*
- `Dùng ứng dụng mở rộng` *(optional)*

### Nên TẮT
- `Người Quản Lý` *(trừ khi bạn muốn full quyền tuyệt đối)*
- `Cấm Thành Viên` *(nếu không cần moderation cộng đồng)*
- `Đuổi thành viên` *(nếu không cần moderation cộng đồng)*
- `Tạo Các Chủ Đề Riêng Tư`
- `Gửi Tin Nhắn Văn Bản Thành Giọng Nói`
- `Gửi tin nhắn thoại`

## 5.2. Role `Technician`

### Nên BẬT
#### ⚙️ Quyền Tổng Quát Máy Chủ
- `Xem Các Kênh`

#### 👤 Quyền Thành Viên
- `Đổi Biệt Danh`

#### 💬 Quyền Kênh Tin Nhắn
- `Gửi tin nhắn và tạo bài đăng`
- `Gửi tin nhắn trong chủ đề và bài đăng`
- `Nhúng liên kết`
- `Đính kèm tập tin`
- `Thêm Biểu Cảm`
- `Xem lịch sử tin nhắn`

#### 🎙️ Quyền Kênh Thoại
- `Kết nối`
- `Nói`
- `Video`
- `Sử dụng chế độ tự động nhận diện giọng nói`

#### 🤖 Quyền Ứng Dụng
- `Sử Dụng Câu Lệnh Ứng Dụng`

### Nên TẮT
- `Quản Lý Kênh`
- `Quản Lý Vai Trò`
- `Xem Nhật Ký Chỉnh Sửa`
- `Quản lý Webhook`
- `Quản lý phòng`
- `Quản Lý Biệt Danh`
- `Đuổi thành viên`
- `Cấm Thành Viên`
- `Hạn chế thành viên`
- `Tạo Chủ Đề Công Khai`
- `Tạo Các Chủ Đề Riêng Tư`
- `Đề cập @everyone, @here và Tất Cả Vai Trò`
- `Quản lý tin nhắn`
- `Ghim Tin Nhắn`
- `Bỏ Qua Chế Độ Chậm`
- `Quản lý chủ đề và bài đăng`
- `Gửi Tin Nhắn Văn Bản Thành Giọng Nói`
- `Gửi tin nhắn thoại`
- `Tạo khảo sát` *(optional, thường nên tắt)*
- `Người Nói Ưu Tiên`
- `Tắt âm thành viên`
- `Tắt nghe thành viên`
- `Di chuyển thành viên`
- `Đặt trạng thái Kênh Thoại`

## 5.3. Role `Researcher`

Role này nên gần giống `Technician`.

### Nên BẬT
- `Xem Các Kênh`
- `Đổi Biệt Danh`
- `Gửi tin nhắn và tạo bài đăng`
- `Gửi tin nhắn trong chủ đề và bài đăng`
- `Nhúng liên kết`
- `Đính kèm tập tin`
- `Thêm Biểu Cảm`
- `Xem lịch sử tin nhắn`
- `Kết nối`
- `Nói`
- `Video`
- `Sử dụng chế độ tự động nhận diện giọng nói`
- `Sử Dụng Câu Lệnh Ứng Dụng`

### Nên TẮT
Tắt toàn bộ các quyền quản trị giống `Technician`:
- quản trị server
- quản trị kênh
- quản trị role
- quản trị tin nhắn
- quản lý chủ đề
- moderation member
- `@everyone` mention
- voice moderation

---

## 6. Quyền chuẩn cho bot TaskBot

Bot không cần `Người Quản Lý`.

## 6.1. Nên BẬT
#### ⚙️ Quyền Tổng Quát Máy Chủ
- `Xem Các Kênh`

#### 💬 Quyền Kênh Tin Nhắn
- `Gửi tin nhắn và tạo bài đăng`
- `Gửi tin nhắn trong chủ đề và bài đăng`
- `Tạo Chủ Đề Công Khai`
- `Nhúng liên kết`
- `Đính kèm tập tin` *(optional)*
- `Xem lịch sử tin nhắn`
- `Quản lý chủ đề và bài đăng`

## 6.2. Có thể BẬT thêm nếu muốn dễ vận hành hơn
- `Quản lý tin nhắn` *(không bắt buộc cho workflow hiện tại)*

## 6.3. Nên TẮT
- `Người Quản Lý`
- `Quản Lý Kênh`
- `Quản Lý Vai Trò`
- `Đề cập @everyone, @here và Tất Cả Vai Trò`
- các quyền moderation member
- các quyền thoại

## 6.4. Vì sao bot cần các quyền này
- `Xem Các Kênh` → để nhìn thấy dashboard/feed
- `Gửi tin nhắn` → để đăng summary, task card, feed notice
- `Gửi trong chủ đề` → để gửi starter message vào thread
- `Tạo Chủ Đề Công Khai` → để tạo workspace thread khi claim
- `Nhúng liên kết` → để render embed
- `Xem lịch sử tin nhắn` → để fetch/edit message cũ
- `Quản lý chủ đề` → để archive/reopen thread theo workflow

---

## 7. Thiết lập quyền theo từng category và từng kênh

### Quy ước trong bảng
- **Bật** = nên Allow rõ ràng
- **Tắt** = nên Deny hoặc giữ Off rõ ràng
- **Không cần** = không cần bật riêng, có thể để neutral

Lưu ý:
- nếu bạn đang dùng server theo mô hình role-based chặt, nên để `@everyone` ở mức rất thấp
- chỉ cho các role `Admin`, `Technician`, `Researcher` nhìn thấy các khu vực làm việc chính

---

## 7.1. Category `THÔNG TIN`

### Mục tiêu
- ai vào server cũng đọc được nội dung định hướng
- không biến thành khu chat chính

### 7.1.1. `#chao-mung-va-noi-quy`

| Role | Xem Kênh | Gửi tin nhắn | Nhúng liên kết | Đính kèm tập tin | Thêm Biểu Cảm | Xem lịch sử tin nhắn | Sử Dụng Câu Lệnh Ứng Dụng | Ghi chú |
|---|---|---|---|---|---|---|---|---|
| `@everyone` | Bật | Tắt | Không cần | Không cần | Tắt | Bật | Không cần | Kênh đọc |
| `Admin` | Bật | Bật | Bật | Bật | Bật | Bật | Bật | Có thể cập nhật nội quy |
| `Technician` | Bật | Tắt | Không cần | Không cần | Tắt | Bật | Bật | Chỉ đọc |
| `Researcher` | Bật | Tắt | Không cần | Không cần | Tắt | Bật | Bật | Chỉ đọc |
| Bot | Bật | Không cần | Không cần | Không cần | Không cần | Bật | Không cần | Không bắt buộc dùng |

### 7.1.2. `#thong-bao`

| Role | Xem Kênh | Gửi tin nhắn | Nhúng liên kết | Đính kèm tập tin | Thêm Biểu Cảm | Xem lịch sử tin nhắn | Sử Dụng Câu Lệnh Ứng Dụng | Ghi chú |
|---|---|---|---|---|---|---|---|---|
| `@everyone` | Bật | Tắt | Không cần | Không cần | Tắt | Bật | Không cần | Kênh announcement |
| `Admin` | Bật | Bật | Bật | Bật | Bật | Bật | Bật | Chỉ Admin đăng |
| `Technician` | Bật | Tắt | Không cần | Không cần | Tắt | Bật | Bật | Chỉ đọc |
| `Researcher` | Bật | Tắt | Không cần | Không cần | Tắt | Bật | Bật | Chỉ đọc |
| Bot | Bật | Không cần | Không cần | Không cần | Không cần | Bật | Không cần | Không bắt buộc |

### 7.1.3. `#tai-nguyen`

| Role | Xem Kênh | Gửi tin nhắn | Nhúng liên kết | Đính kèm tập tin | Thêm Biểu Cảm | Xem lịch sử tin nhắn | Sử Dụng Câu Lệnh Ứng Dụng | Ghi chú |
|---|---|---|---|---|---|---|---|---|
| `@everyone` | Bật | Tắt | Không cần | Không cần | Tắt | Bật | Không cần | Giữ sạch như thư viện tài liệu |
| `Admin` | Bật | Bật | Bật | Bật | Bật | Bật | Bật | Curate tài liệu |
| `Technician` | Bật | Tắt *(khuyến nghị)* | Không cần | Không cần | Tắt | Bật | Bật | Nếu muốn góp tài liệu, có thể cho gửi tin nhắn |
| `Researcher` | Bật | Tắt *(khuyến nghị)* | Không cần | Không cần | Tắt | Bật | Bật | Nếu muốn góp tài liệu, có thể cho gửi tin nhắn |
| Bot | Bật | Không cần | Không cần | Không cần | Không cần | Bật | Không cần | Không bắt buộc |

---

## 7.2. Category `TASKBOT`

### Mục tiêu
- đây là khu vực workflow chính
- `#task-dashboard` phải hoạt động ổn định nhất
- các contributor phải làm việc được trong thread nhưng không được quản trị kênh/thread

### Khuyến nghị cho category `TASKBOT`
- `@everyone`: **Tắt** `Xem Kênh` nếu bạn muốn chỉ 3 role chính nhìn thấy khu này
- `Admin`, `Technician`, `Researcher`, Bot: Bật `Xem Kênh`

### 7.2.1. `#task-dashboard`

Đây là kênh quan trọng nhất của toàn hệ thống.

| Role | Xem Kênh | Gửi tin nhắn | Gửi Tin Nhắn trong Chủ Đề | Tạo Chủ Đề Công Khai | Tạo Chủ Đề Riêng Tư | Nhúng liên kết | Đính kèm tập tin | Thêm Biểu Cảm | Đề cập @everyone | Quản lý tin nhắn | Ghim Tin Nhắn | Quản Lý Chủ Đề | Xem lịch sử tin nhắn | Sử Dụng Câu Lệnh Ứng Dụng | Ghi chú |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `@everyone` | Tắt *(khuyến nghị)* | Tắt | Tắt | Tắt | Tắt | Tắt | Tắt | Tắt | Tắt | Tắt | Tắt | Tắt | Tắt | Tắt | Chỉ bật nếu bạn muốn công khai dashboard |
| `Admin` | Bật | Bật | Bật | Không cần | Tắt | Bật | Bật | Bật | Tắt | Bật | Bật *(optional)* | Bật | Bật | Bật | Admin có thể vận hành thủ công nếu cần |
| `Technician` | Bật | Bật *(khuyến nghị)* | Bật | Tắt | Tắt | Bật | Bật | Bật | Tắt | Tắt | Tắt | Tắt | Bật | Bật | Có thể chat ngắn dưới card nếu cần, nhưng nên ưu tiên thread |
| `Researcher` | Bật | Bật *(khuyến nghị)* | Bật | Tắt | Tắt | Bật | Bật | Bật | Tắt | Tắt | Tắt | Tắt | Bật | Bật | Giống Technician |
| Bot | Bật | Bật | Bật | Bật | Tắt | Bật | Bật *(optional)* | Không cần | Tắt | Không cần *(optional)* | Không cần | Bật | Bật | Không cần | Đây là bộ quyền cốt lõi của bot |

#### Ghi chú vận hành cho `#task-dashboard`
- Contributor không cần quyền `Tạo Chủ Đề Công Khai`, vì bot là bên tạo thread chính
- Contributor không nên có `Quản Lý Chủ Đề`
- Bot bắt buộc phải có:
  - `Xem Kênh`
  - `Gửi tin nhắn`
  - `Gửi Tin Nhắn trong Chủ Đề`
  - `Tạo Chủ Đề Công Khai`
  - `Nhúng liên kết`
  - `Xem lịch sử tin nhắn`
  - `Quản Lý Chủ Đề`

### 7.2.2. `#task-feed`

| Role | Xem Kênh | Gửi tin nhắn | Nhúng liên kết | Đính kèm tập tin | Thêm Biểu Cảm | Xem lịch sử tin nhắn | Quản lý tin nhắn | Sử Dụng Câu Lệnh Ứng Dụng | Ghi chú |
|---|---|---|---|---|---|---|---|---|---|
| `@everyone` | Tắt *(khuyến nghị)* | Tắt | Tắt | Tắt | Tắt | Tắt | Tắt | Tắt | Nếu muốn khu TASKBOT riêng hoàn toàn |
| `Admin` | Bật | Bật | Bật | Bật | Bật | Bật | Bật *(optional)* | Bật | Admin theo dõi log và phản hồi |
| `Technician` | Bật | Tắt *(khuyến nghị)* | Không cần | Không cần | Bật *(optional)* | Bật | Tắt | Bật | Nên để đọc log là chính |
| `Researcher` | Bật | Tắt *(khuyến nghị)* | Không cần | Không cần | Bật *(optional)* | Bật | Tắt | Bật | Nên để đọc log là chính |
| Bot | Bật | Bật | Bật | Không cần | Không cần | Bật | Không cần | Không cần | Bot cần đăng log repair/sync |

### 7.2.3. `#daily-check-in`

| Role | Xem Kênh | Gửi tin nhắn | Nhúng liên kết | Đính kèm tập tin | Thêm Biểu Cảm | Xem lịch sử tin nhắn | Quản lý tin nhắn | Sử Dụng Câu Lệnh Ứng Dụng | Ghi chú |
|---|---|---|---|---|---|---|---|---|---|
| `@everyone` | Tắt *(khuyến nghị)* | Tắt | Tắt | Tắt | Tắt | Tắt | Tắt | Tắt | Chỉ 3 role chính nhìn thấy |
| `Admin` | Bật | Bật | Bật | Bật | Bật | Bật | Bật *(optional)* | Bật | Admin có thể chốt daily/EOD |
| `Technician` | Bật | Bật | Bật | Bật | Bật | Bật | Tắt | Bật | Báo cáo hằng ngày |
| `Researcher` | Bật | Bật | Bật | Bật | Bật | Bật | Tắt | Bật | Báo cáo hằng ngày |
| Bot | Bật | Không cần | Không cần | Không cần | Không cần | Bật | Không cần | Không cần | Bot không cần quyền mạnh ở đây |

### 7.2.4. `#task-archive` *(optional)*

| Role | Xem Kênh | Gửi tin nhắn | Nhúng liên kết | Đính kèm tập tin | Xem lịch sử tin nhắn | Sử Dụng Câu Lệnh Ứng Dụng | Ghi chú |
|---|---|---|---|---|---|---|---|
| `@everyone` | Tắt *(khuyến nghị)* | Tắt | Tắt | Tắt | Tắt | Tắt | Có thể ẩn nếu chỉ là kho nội bộ |
| `Admin` | Bật | Bật *(optional)* | Bật | Bật | Bật | Bật | Dùng cho tổng kết, bàn giao |
| `Technician` | Bật *(optional)* | Tắt *(khuyến nghị)* | Không cần | Không cần | Bật *(optional)* | Bật | Tùy mức minh bạch bạn muốn |
| `Researcher` | Bật *(optional)* | Tắt *(khuyến nghị)* | Không cần | Không cần | Bật *(optional)* | Bật | Tùy mức minh bạch bạn muốn |
| Bot | Bật | Không cần *(hiện tại)* | Không cần | Không cần | Bật | Không cần | Bot chưa tự post done-task vào đây |

---

## 7.3. Category `THẢO LUẬN`

### 7.3.1. `#chung`

| Role | Xem Kênh | Gửi tin nhắn | Nhúng liên kết | Đính kèm tập tin | Thêm Biểu Cảm | Đề cập @everyone | Xem lịch sử tin nhắn | Tạo khảo sát | Sử Dụng Câu Lệnh Ứng Dụng | Ghi chú |
|---|---|---|---|---|---|---|---|---|---|---|
| `@everyone` | Tắt *(khuyến nghị nếu bạn muốn role-based access chặt)* | Tắt | Tắt | Tắt | Tắt | Tắt | Tắt | Tắt | Tắt | Nếu ai cũng phải có role thì nên tắt |
| `Admin` | Bật | Bật | Bật | Bật | Bật | Tắt | Bật | Bật *(optional)* | Bật | Chat chung |
| `Technician` | Bật | Bật | Bật | Bật | Bật | Tắt | Bật | Bật *(optional)* | Bật | Chat chung |
| `Researcher` | Bật | Bật | Bật | Bật | Bật | Tắt | Bật | Bật *(optional)* | Bật | Chat chung |
| Bot | Bật | Không cần | Không cần | Không cần | Không cần | Tắt | Bật | Không cần | Không cần | Bot không cần quyền mạnh |

---

## 7.4. Category `QUẢN TRỊ`

### Mục tiêu
Khu riêng cho `Admin`.

### 7.4.1. `#admin-dieu-phoi`

| Role | Xem Kênh | Gửi tin nhắn | Nhúng liên kết | Đính kèm tập tin | Thêm Biểu Cảm | Quản lý tin nhắn | Xem lịch sử tin nhắn | Sử Dụng Câu Lệnh Ứng Dụng | Ghi chú |
|---|---|---|---|---|---|---|---|---|---|
| `@everyone` | Tắt | Tắt | Tắt | Tắt | Tắt | Tắt | Tắt | Tắt | Kênh private |
| `Admin` | Bật | Bật | Bật | Bật | Bật | Bật *(optional)* | Bật | Bật | Chỉ Admin vận hành |
| `Technician` | Tắt | Tắt | Tắt | Tắt | Tắt | Tắt | Tắt | Tắt | Không truy cập |
| `Researcher` | Tắt | Tắt | Tắt | Tắt | Tắt | Tắt | Tắt | Tắt | Không truy cập |
| Bot | Bật *(optional)* | Không cần | Không cần | Không cần | Không cần | Không cần | Bật *(optional)* | Không cần | Chỉ bật nếu muốn dùng cho ops với bot sau này |

---

## 7.5. Category `PHÒNG THOẠI`

Bot hiện không dùng voice, nên chỉ cần phân quyền cho người dùng.

### 7.5.1. `Phòng chờ` / `Họp nhanh` / `Họp nhóm`

| Role | Kết nối | Nói | Video | Sử dụng chế độ tự động nhận diện giọng nói | Tắt âm thành viên | Tắt nghe thành viên | Di chuyển thành viên | Ghi chú |
|---|---|---|---|---|---|---|---|---|
| `Admin` | Bật | Bật | Bật | Bật | Bật *(optional)* | Bật *(optional)* | Bật *(optional)* | Tùy mức quản trị voice bạn muốn |
| `Technician` | Bật | Bật | Bật | Bật | Tắt | Tắt | Tắt | Thành viên thường |
| `Researcher` | Bật | Bật | Bật | Bật | Tắt | Tắt | Tắt | Thành viên thường |
| Bot | Tắt | Tắt | Tắt | Tắt | Tắt | Tắt | Tắt | Không cần voice |

---

## 8. Các quyền nên tránh cấp bừa

Trừ khi bạn có lý do rõ ràng, không nên cấp rộng các quyền sau:
- `Người Quản Lý`
- `Quản Lý Vai Trò` cho contributor
- `Quản Lý Kênh` cho contributor
- `Quản lý tin nhắn` cho contributor
- `Quản Lý Chủ Đề` cho contributor
- `Đề cập @everyone, @here và Tất Cả Vai Trò`
- các quyền moderation member cho contributor
- các quyền voice moderation cho contributor

---

## 9. Checklist setup bài bản

### Bước 1 — Tạo role
- [ ] `Admin`
- [ ] `Technician`
- [ ] `Researcher`

### Bước 2 — Tạo category
- [ ] `THÔNG TIN`
- [ ] `TASKBOT`
- [ ] `THẢO LUẬN`
- [ ] `QUẢN TRỊ`
- [ ] `PHÒNG THOẠI`

### Bước 3 — Tạo các kênh chính
- [ ] `#chao-mung-va-noi-quy`
- [ ] `#thong-bao`
- [ ] `#tai-nguyen`
- [ ] `#task-dashboard`
- [ ] `#task-feed`
- [ ] `#daily-check-in`
- [ ] `#chung`
- [ ] `#admin-dieu-phoi`
- [ ] `#task-archive` *(optional)*

### Bước 4 — Cấp quyền cho bot ở `#task-dashboard`
- [ ] `Xem Kênh`
- [ ] `Gửi tin nhắn`
- [ ] `Gửi Tin Nhắn trong Chủ Đề`
- [ ] `Tạo Chủ Đề Công Khai`
- [ ] `Nhúng liên kết`
- [ ] `Xem lịch sử tin nhắn`
- [ ] `Quản Lý Chủ Đề`

### Bước 5 — Cấp quyền cho 3 role chính
- [ ] `Admin` có toàn quyền vận hành cần thiết
- [ ] `Technician` và `Researcher` có đủ quyền làm việc, nhưng không có quyền quản trị
- [ ] `@everyone` không nhìn thấy khu vực nhạy cảm nếu bạn muốn role-based access chặt

### Bước 6 — Chạy `/setup`
Khi chạy `/setup`, điền:
- `dashboard_channel` = `#task-dashboard`
- `feed_channel` = `#task-feed`
- `admin_role` = `Admin`
- `archive_channel` = để trống hoặc `#task-archive`
- `reviewer_role` = **để trống**
- `max_active_tasks` = ví dụ `2`
- `thread_auto_archive_minutes` = `1440`

---

## 10. Kết luận vận hành

Mô hình chuẩn nên là:
- **3 role**: `Admin`, `Technician`, `Researcher`
- **1 dashboard trung tâm**: `#task-dashboard`
- **1 feed log**: `#task-feed`
- **1 kênh daily**: `#daily-check-in`
- **mỗi task = 1 public thread**

Đây là mô hình sạch, hiện đại, và đúng với TaskBot hiện tại.

## 11. Tài liệu tiếp theo

Sau khi hoàn tất Discord server, đọc tiếp:
- [Cài đặt và sử dụng bot](02-bot-setup-and-daily-use.md)
