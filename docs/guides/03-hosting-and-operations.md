# Hosting và vận hành

## 1. Mục tiêu

Tài liệu này là runbook triển khai và vận hành TaskBot theo implementation hiện tại.

TaskBot không phải web app HTTP. Đây là **Discord Gateway worker** chạy nền lâu dài. Cách host đúng là:
- 1 process Node.js
- 1 SQLite database
- 1 host có persistent storage
- 1 bot config chính cho 1 hoặc vài server Discord gần nhau về vận hành

---

## 2. Mô hình host repo hiện hỗ trợ tốt nhất

Hiện tại project phù hợp nhất với:
- local development
- máy cá nhân/lab luôn bật
- VPS nhỏ / server riêng

Phù hợp nhất khi:
- bạn chỉ chạy **1 instance bot**
- file DB nằm trên persistent storage
- bạn chủ động việc backup và restart

Chưa phải mô hình first-class của repo:
- Docker
- Kubernetes
- multi-instance
- serverless
- static hosting

---

## 3. Kiến trúc deploy thực tế của TaskBot

TaskBot chạy như sau:
- process Node.js đăng nhập vào Discord Gateway
- Discord gửi interaction về bot
- bot đọc/ghi state trong SQLite qua Prisma
- dashboard/card/thread trên Discord chỉ là lớp hiển thị từ database

Điều này dẫn tới 3 kết luận vận hành rất quan trọng:
1. **Database là source of truth**
2. chỉ nên chạy **1 process bot** với SQLite
3. nếu Discord bị lệch state, bạn repair bằng `/task sync-dashboard` sau khi sửa nguyên nhân gốc

---

## 4. Lưu ý quan trọng về SQLite

TaskBot hiện dùng SQLite vì:
- đơn giản
- dễ setup
- rất phù hợp MVP / single-process

Nhưng bạn phải nhớ:
- SQLite không phù hợp cho nhiều replica cùng ghi
- mất file DB là mất dữ liệu nếu không có backup
- filesystem ephemeral là không an toàn
- path `DATABASE_URL=file:...` cần được kiểm soát rõ khi deploy

### Khuyến nghị production
- chỉ chạy 1 bot instance
- đặt DB trên persistent storage
- backup DB trước mỗi lần deploy hoặc migrate schema
- dùng path rõ ràng, ví dụ:

```env
DATABASE_URL=file:/opt/taskbot/data/taskbot.db
```

---

## 5. Host nào nên dùng

## 5.1. Local development
Phù hợp khi:
- test command
- debug quyền Discord
- kiểm thử workflow
- chỉnh docs

Không phù hợp khi:
- cần uptime thật
- team dùng hằng ngày

## 5.2. Máy cá nhân / máy lab luôn bật
Phù hợp khi:
- chưa muốn thuê VPS
- bot chưa quá critical
- chấp nhận rủi ro restart máy/mất điện/mạng yếu

Khuyến nghị:
- vẫn dùng `build + start` cho chế độ chạy lâu dài
- không nên để production phụ thuộc vào terminal watch mode

## 5.3. VPS / server riêng
Đây là lựa chọn khuyến nghị hiện tại.

Ưu điểm:
- uptime ổn hơn
- chủ động Node version, filesystem, restart
- dễ dùng PM2
- dễ backup SQLite

## 5.4. PaaS / cloud worker
Có thể dùng **nếu** platform hỗ trợ:
- long-running background worker
- persistent disk/volume
- outbound Discord Gateway connection

Có thể cân nhắc:
- Railway với persistent volume
- Render background worker với persistent disk
- Fly.io machine/app với volume
- VM/cloud instance thông thường

Không phù hợp trong current state:
- Vercel
- Netlify
- serverless function platforms
- nơi chỉ hỗ trợ HTTP app
- nơi filesystem ephemeral mà không có persistent storage

---

## 6. Biến môi trường production

Tối thiểu cần có:

```env
DISCORD_TOKEN=...
CLIENT_ID=...
DATABASE_URL=file:/opt/taskbot/data/taskbot.db
NODE_ENV=production
```

Optional:

```env
GUILD_ID=...
```

### Ý nghĩa thực tế
- `DISCORD_TOKEN` → token bot, tuyệt đối không commit
- `CLIENT_ID` → Discord Application ID
- `DATABASE_URL` → đường dẫn SQLite phải nằm trên persistent storage
- `NODE_ENV=production` → production runtime
- `GUILD_ID` → nên dùng nếu bot phục vụ 1 server cụ thể và bạn muốn command propagate nhanh hơn

---

## 7. Quy trình deploy production chuẩn

## Bước 1 — Chuẩn bị host
Yêu cầu:
- Node.js `>=24.0.0`
- npm
- persistent storage cho SQLite
- user/system có quyền ghi vào thư mục data

## Bước 2 — Copy source code lên host
Clone repo hoặc copy source code.

## Bước 3 — Tạo file `.env`
Điền đúng giá trị production.

Ví dụ:

```env
DISCORD_TOKEN=your_bot_token_here
CLIENT_ID=your_discord_application_id_here
DATABASE_URL=file:/opt/taskbot/data/taskbot.db
NODE_ENV=production
```

## Bước 4 — Cài dependency
Khuyến nghị dùng lockfile:

```bash
npm ci
```

## Bước 5 — Validate Prisma schema
```bash
npm run prisma:validate
```

## Bước 6 — Generate Prisma client
```bash
npm run prisma:generate
```

## Bước 7 — Chạy migration production
```bash
npm run prisma:migrate:deploy
```

Lưu ý:
- `prisma:migrate:dev` chỉ dành cho local development
- production phải dùng `prisma migrate deploy`

## Bước 8 — Register slash commands
```bash
npm run register:commands
```

Bạn không cần chạy bước này ở mọi lần restart. Chỉ chạy lại khi command definition thay đổi.

## Bước 9 — Build app
```bash
npm run build
```

## Bước 10 — Start bot
```bash
npm run start
```

---

## 8. Nên chạy kiểu nào ở production

### Development
```bash
npm run dev
```

### Production
```bash
npm run build
npm run start
```

Không nên dùng `tsx watch` cho host production lâu dài nếu không thật sự cần hot reload.

---

## 9. Dùng PM2 để giữ bot sống

Một bot production không nên phụ thuộc vào terminal đang mở.

## 9.1. Cài PM2
```bash
npm install -g pm2
```

## 9.2. Start bot bằng PM2
```bash
pm2 start npm --name taskbot -- run start
```

## 9.3. Lệnh PM2 hữu ích
```bash
pm2 status
pm2 logs taskbot
pm2 restart taskbot
pm2 stop taskbot
pm2 delete taskbot
pm2 save
```

## 9.4. Gợi ý thực tế
Sau khi PM2 chạy ổn:
- bật startup integration của PM2 theo OS
- đảm bảo máy reboot xong bot tự lên lại
- cân nhắc log rotation nếu host chạy lâu dài

---

## 10. Khi nào phải chạy lại `register:commands`

Chạy lại khi:
- đổi tên command
- đổi description
- đổi options
- thêm/xóa command
- đổi `GUILD_ID`

### Khuyến nghị development
Dùng `GUILD_ID` để command xuất hiện nhanh hơn.

### Khuyến nghị production
Nếu bot chủ yếu phục vụ 1 server/team:
- guild-scoped command là lựa chọn dễ kiểm soát và propagate nhanh

---

## 11. Quy trình update an toàn

Mỗi lần update production, làm theo thứ tự này:

1. backup DB
2. stop bot
3. pull/copy code mới
4. cài dependency lại nếu cần:
   ```bash
   npm ci
   ```
5. generate Prisma client:
   ```bash
   npm run prisma:generate
   ```
6. chạy migration production nếu có schema change:
   ```bash
   npm run prisma:migrate:deploy
   ```
7. register commands lại nếu command definition thay đổi:
   ```bash
   npm run register:commands
   ```
8. build app:
   ```bash
   npm run build
   ```
9. start/restart bot:
   ```bash
   npm run start
   ```
   hoặc:
   ```bash
   pm2 restart taskbot
   ```
10. verify `/ping`, `/setup` (nếu cần), dashboard, permissions

---

## 12. Backup và rollback tối thiểu

### Khi nào nên backup
- trước mỗi lần deploy
- trước mỗi lần migrate schema
- trước khi chuyển host
- định kỳ nếu team dùng hằng ngày

### Backup tối thiểu
Cách đơn giản nhất:
1. dừng bot
2. copy file SQLite ra nơi khác
3. ghi lại version/source code đang chạy

### Rollback tối thiểu
Nếu bản deploy mới lỗi:
1. stop bot
2. restore source code cũ
3. restore DB nếu migration hoặc dữ liệu đã gây vấn đề
4. start lại bot
5. test `/ping` và dashboard

---

## 13. Checklist verify sau deploy

Sau khi deploy, kiểm tra ít nhất:
1. log có dòng `Starting TaskBot...`
2. log có dòng `Logged in as ...`
3. `/ping` hoạt động
4. slash commands xuất hiện đúng server
5. `/setup` chạy được nếu cần cấu hình mới
6. bot nhìn thấy `#task-dashboard` và `#task-feed`
7. tạo được task mới
8. claim được task và thread mở đúng
9. `/task sync-dashboard` hoạt động
10. file DB tồn tại ở persistent path bạn dự kiến

---

## 14. Security notes

### Secret handling
- không commit `.env`
- không đưa bot token vào README/public docs
- nếu lộ token, reset token ngay trong Discord Developer Portal

### Discord permissions
- chỉ cấp quyền bot thật sự cần thiết
- không cần cấp `Administrator`
- role `Admin` của bot chỉ nên cấp cho người vận hành thật sự

### Database safety
- backup trước deploy/migrate
- không chạy nhiều instance chung 1 SQLite file
- không đặt DB ở nơi có thể mất sau restart/deploy

---

## 15. Những giới hạn hiện tại của repo

Hiện repo **chưa** đi kèm:
- Dockerfile
- Docker Compose
- systemd service file
- backup script tự động
- cloud deploy config chuẩn hóa
- monitoring / metrics / health endpoint HTTP

Điều đó không ngăn bạn deploy, nhưng nghĩa là current production model vẫn là:
- 1 background worker
- 1 SQLite database
- 1 PM2-managed process

---

## 16. Khi nào nên nâng cấp khỏi SQLite

Cân nhắc PostgreSQL hoặc DB khác nếu bạn bắt đầu cần:
- nhiều bot instances
- nhiều worker cùng ghi
- cloud-native scaling
- backup/restore tốt hơn
- truy vấn lớn hơn khi task volume tăng nhiều

---

## 17. Tài liệu liên quan

- [Thiết lập Discord Server](01-discord-server-setup.md)
- [Cài đặt và sử dụng bot](02-bot-setup-and-daily-use.md)
- [Xử lý sự cố và khôi phục](04-troubleshooting-and-recovery.md)