# Xử lý sự cố và khôi phục

## 1. Mục tiêu

Tài liệu này hướng dẫn bạn xử lý các lỗi thường gặp khi vận hành TaskBot và cách khôi phục khi trạng thái trên Discord bị lệch khỏi database.

Nguyên tắc quan trọng nhất:

> Database là source of truth.

Nếu bot đã ghi đúng DB nhưng Discord message/thread bị lỗi, task vẫn có thể hợp lệ và sửa lại được bằng `/task sync-dashboard` sau khi bạn sửa nguyên nhân gốc.

---

## 2. Bảng chẩn đoán nhanh

| Hiện tượng | Nguyên nhân hay gặp | Cách xử lý đầu tiên |
|---|---|---|
| Không thấy slash command | Chưa register command, sai `GUILD_ID`, bot mời thiếu `applications.commands` | Register lại command |
| Bot online nhưng `/setup` fail | Người chạy không có `Manage Server`, channel sai loại, bot thiếu quyền | Kiểm tra quyền và loại channel |
| Tạo task được nhưng claim không ra thread | Bot thiếu quyền thread ở dashboard | Sửa quyền rồi chạy `/task sync-dashboard` |
| Contributor claim/join fail | Sai role name, task full, hoặc chạm limit active task | Kiểm tra role `Technician` / `Researcher`, `team_size`, và active limit |
| Summary mất | Message summary bị xóa | Chạy `/task sync-dashboard` |
| Task card mất | Message task bị xóa | Chạy `/task sync-dashboard` |
| Thread bị archive sai | Có người archive thủ công hoặc drift | Chạy `/task sync-dashboard` |
| Feed không có log | Bot không thấy `#task-feed` hoặc config sai | Kiểm tra quyền/feed channel và có thể rerun `/setup` |

---

## 3. Không thấy slash command

## Nguyên nhân thường gặp
- chưa chạy `npm run register:commands`
- `CLIENT_ID` sai
- `DISCORD_TOKEN` sai
- `GUILD_ID` sai khi register theo guild
- bot được mời thiếu scope `applications.commands`
- Discord client chưa refresh kịp

## Cách xử lý
1. kiểm tra `.env`
2. kiểm tra bot đã ở đúng server chưa
3. chạy lại:
   ```bash
   npm run register:commands
   ```
4. nếu PowerShell chặn `npm`, dùng:
   ```powershell
   npm.cmd run register:commands
   ```
5. reload Discord rồi kiểm tra lại

---

## 4. Bot online nhưng không phản hồi

## Kiểm tra cơ bản
1. log có dòng login thành công không
2. `/ping` có hoạt động không
3. command đã register cho đúng guild chưa
4. bot có nhìn thấy channel bạn đang test không
5. bot có bị thiếu quyền gửi tin nhắn hoặc dùng application command không

Nếu `/ping` không chạy được, ưu tiên xử lý:
- env
- token
- command registration
- quyền nhìn thấy channel

---

## 5. `/setup` fail

## Điều kiện bắt buộc
`/setup` chỉ chạy được khi:
- đang ở trong server
- người chạy có Discord permission `Manage Server` / `ManageGuild`

## Lỗi thường gặp
- chạy trong DM
- người chạy không có `Manage Server`
- chọn channel không phải standard text channel
- bot không có quyền ở `#task-dashboard`
- bot không có quyền ở `#task-feed`

## Cách xử lý
1. vào đúng server
2. dùng account có `Manage Server`
3. chọn text channel thường
4. kiểm tra bot có thể:
   - xem dashboard
   - gửi tin nhắn ở dashboard
   - đọc lịch sử dashboard
   - gửi tin nhắn ở feed
5. chạy lại `/setup`

---

## 6. `/task create` fail

## Nguyên nhân thường gặp
- chưa chạy `/setup`
- người chạy không có `Manage Server`, không có role admin đã cấu hình, và cũng không phải `Technician`
- dashboard channel trong config đã bị xóa hoặc không còn là text channel
- `deadline` không đúng định dạng

## Cách xử lý
1. xác nhận `/setup` đã chạy xong
2. xác nhận user có `Manage Server`, role `Admin` đã cấu hình, hoặc `Technician`
3. xác nhận `#task-dashboard` vẫn đúng channel
4. nếu dùng deadline, nhập theo ISO-8601 có timezone:
   ```text
   2026-07-31T18:00:00+07:00
   ```

---

## 7. Contributor claim fail

Đây là lỗi phổ biến nhất khi mới setup.

## 7.1. Lưu ý quan trọng nhất
Code hiện tại kiểm tra contributor claim theo **tên role**, không phải theo mô tả nghiệp vụ.

Tên đúng phải là:
- `Technician`
- `Researcher`

## 7.2. Ví dụ claim task `TECHNICIAN`
Người claim phải có role tên đúng là:
- `Technician`

Nếu role tên là:
- `Tech`
- `Developer`
- `Kỹ thuật`

thì claim có thể fail.

## 7.3. Các lý do khác
- task đã bị người khác claim
- task không còn ở `Backlog`
- contributor đã chạm `max_active_tasks`
- contributor không thấy hoặc không dùng được dashboard/thread

## Cách xử lý
1. kiểm tra tên role đúng tuyệt đối
2. kiểm tra task còn `Backlog` và chưa assign
3. kiểm tra contributor có đang giữ quá nhiều task active không
4. thử lại nếu vừa có race condition

---

## 8. Claim thành công nhưng không tạo được thread

Đây là lỗi vận hành quan trọng.

## Hành vi hiện tại của bot
Nếu claim thành công nhưng thread tạo lỗi:
- task vẫn có thể đã được assign trong DB
- task vẫn có thể đang ở `In Progress`
- bot có thể log warning vào `#task-feed`
- bạn cần sửa quyền rồi sync lại

## Nguyên nhân hay gặp
Bot thiếu một trong các quyền sau ở `#task-dashboard`:
- `Tạo Chủ Đề Công Khai`
- `Gửi tin nhắn trong chủ đề và bài đăng`
- `Quản lý chủ đề và bài đăng`
- `Xem lịch sử tin nhắn`

## Cách xử lý
1. sửa quyền bot ở `#task-dashboard`
2. xác nhận bot có thể:
   - xem channel
   - gửi tin nhắn
   - đọc lịch sử
   - tạo public thread
   - gửi trong thread
   - quản lý thread
3. chạy:
   ```text
   /task sync-dashboard
   ```
4. kiểm tra thread đã được recreate/reopen chưa

---

## 9. Mất dashboard summary

## Hiện tượng
Summary message trong `#task-dashboard` bị xóa hoặc không cập nhật được.

## Cách xử lý
Chạy:
```text
/task sync-dashboard
```

## Hành vi hiện tại
Sync có thể:
- recreate summary nếu message cũ không fetch được
- cập nhật lại ID summary trong database

---

## 10. Mất task card

## Hiện tượng
Task vẫn tồn tại trong DB nhưng card không còn trong dashboard.

## Cách xử lý
Repair toàn bộ:
```text
/task sync-dashboard
```

Repair 1 task:
```text
/task sync-dashboard task_code:TASK-001
```

## Hành vi hiện tại
Sync có thể:
- recreate task card
- cập nhật lại message ID và channel ID của task

---

## 11. Thread bị archive hoặc deleted sai

## 11.1. Task active nhưng thread bị archive
Với task ở:
- `In Progress`
- `Blocked`
- `Review`

chạy:
```text
/task sync-dashboard
```

Bot có thể reopen thread nếu thread vẫn fetch được.

## 11.2. Task `Done` nhưng thread vẫn mở
Sync có thể archive lại thread cho đúng state.

## 11.3. Thread bị xóa hẳn
Nếu task vẫn cần workspace active:
- sửa quyền trước
- chạy `/task sync-dashboard`
- bot có thể tạo lại thread mới

---

## 12. Khi nào nên dùng `/task sync-dashboard`

Dùng khi:
- summary bị mất
- task card bị mất
- thread bị mất
- thread tạo lỗi sau claim
- thread bị archive/unarchive sai
- Discord state lệch khỏi database

Không nên dùng sync như một cách né sửa nguyên nhân gốc.

Nếu bot vẫn thiếu quyền, sync có thể tiếp tục fail.

---

## 13. Feed channel không có log

## Nguyên nhân thường gặp
- bot không thấy `#task-feed`
- bot không gửi được tin nhắn ở feed
- `feed_channel` trong config sai

## Cách xử lý
1. kiểm tra `#task-feed` còn tồn tại không
2. kiểm tra bot có quyền xem/gửi ở đó không
3. nếu config sai, chạy lại `/setup`
4. chạy lại `/task sync-dashboard` nếu muốn sinh log mới

---

## 14. Lỗi startup và môi trường

## 14.1. Thiếu credential
Nếu bot hoặc script register command fail ngay từ đầu, kiểm tra:
- `DISCORD_TOKEN`
- `CLIENT_ID`

## 14.2. Lỗi database / Prisma
Kiểm tra:
- `DATABASE_URL`
- file DB có còn không
- DB có nằm trên persistent storage không nếu đang chạy production

Chạy lại local:
```bash
npm run prisma:generate
npm run prisma:migrate:dev
```

Nếu đang ở production workflow:
```bash
npm run prisma:generate
npm run prisma:migrate:deploy
```

## 14.3. PowerShell chặn `npm.ps1`
Trên Windows, dùng:
```powershell
npm.cmd run prisma:generate
npm.cmd run prisma:migrate:dev
npm.cmd run register:commands
npm.cmd run dev
```

---

## 15. Lỗi review trong mô hình 3 role

Theo implementation hiện tại:
- `Admin` là vai trò review chính
- `Technician` cũng có thể hỗ trợ review/quản lý workflow
- `reviewer_role` là optional, nếu có thì role đó cũng có thể review

Nếu có lỗi quanh review, kiểm tra:
1. user có role `Admin`, `Technician`, hoặc `reviewer_role` đã cấu hình không
2. task có thật sự đang ở trạng thái `Review` không
3. dashboard card có đang cũ và cần `/task sync-dashboard` không

---

## 16. Những giới hạn hiện tại cần nhớ

Những điều dưới đây là limitation hiện tại, không phải bug nếu đang xảy ra đúng code:
- `archive_channel` chỉ lưu và hiển thị, chưa tự post done-task log
- contributor claim dựa vào role name `Technician` và `Researcher`
- slash command hiện chỉ có:
  - `/ping`
  - `/setup`
  - `/task create`
  - `/task sync-dashboard`
- bot không tự tạo category/channel cho bạn
- bot dùng public thread dưới `#task-dashboard`

---

## 17. Thứ tự khôi phục chuẩn

Khi có sự cố, làm đúng thứ tự này:
1. xác định lỗi thuộc nhóm nào: quyền, cấu trúc channel, command registration, hay drift state
2. sửa nguyên nhân gốc trước
3. nếu Discord artifact bị lệch, chạy `/task sync-dashboard`
4. verify task trên dashboard đã khớp lại với DB chưa

---

## 18. Khi nào nên chạy lại `/setup`

Nên chạy lại `/setup` khi:
- đổi `#task-dashboard`
- đổi `#task-feed`
- đổi role `Admin`
- muốn thêm hoặc bỏ `#task-archive`
- đổi limit active task
- đổi thread auto-archive

Với mô hình 3 role chuẩn này, `reviewer_role` luôn để trống.

---

## 19. Bộ triage tối thiểu khi bí

Nếu chưa biết lỗi nằm ở đâu, làm theo checklist này:
1. test `/ping`
2. kiểm tra bot online chưa
3. kiểm tra slash command đã register chưa
4. kiểm tra quyền bot ở `#task-dashboard` và `#task-feed`
5. kiểm tra role `Admin`, `Technician`, `Researcher`
6. nếu nghi config sai, chạy lại `/setup`
7. nếu nghi Discord drift, chạy `/task sync-dashboard`

---

## 20. Tài liệu liên quan

- [Thiết lập Discord Server](01-discord-server-setup.md)
- [Cài đặt và sử dụng bot](02-bot-setup-and-daily-use.md)
- [Hosting và vận hành](03-hosting-and-operations.md)
