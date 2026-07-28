# TaskBot

TaskBot là bot quản lý công việc chạy trực tiếp trong Discord cho nhóm nhỏ và vừa, ưu tiên workflow nhanh, rõ trách nhiệm, dễ phục hồi khi Discord bị lệch trạng thái. Thay vì web dashboard riêng, TaskBot dùng chính Discord làm giao diện vận hành:

- 1 summary dashboard ở `#task-dashboard`
- 1 task card cho mỗi task
- 1 workspace thread public cho mỗi task đang hoạt động
- SQLite/Prisma làm **source of truth**
- `/task sync-dashboard` để repair khi message hoặc thread bị lệch

## Trạng thái dự án

- Phiên bản hiện tại: `0.1.0`
- Mức độ hoàn thiện: **MVP+ vận hành được**
- Mục tiêu phù hợp nhất hiện nay:
  - 1 server Discord chính
  - 1 bot process
  - 1 SQLite database trên persistent storage
  - nhóm cộng tác nhỏ cần quản lý task ngay trong Discord

## Tính năng chính hiện đã hỗ trợ

### Dashboard và workflow
- summary dashboard tự refresh khi task thay đổi
- task card chi tiết cho từng task
- workflow trạng thái:
  - `Backlog`
  - `In Progress`
  - `Blocked`
  - `Review`
  - `Done`
- task thread public tự tạo/mở lại khi cần
- repair dashboard/card/thread từ DB bằng `/task sync-dashboard`

### Team-based task
- task có `team_size`
- 1 task có thể có nhiều thành viên
- hiện `Join Task` chỉ xuất hiện khi task còn thiếu người
- summary hiển thị team active theo từng task

### Quyền vận hành
- `Admin` là vai trò quản lý chính
- `Technician` có thể hỗ trợ `Admin` trong nhiều thao tác quản lý/review theo implementation hiện tại
- `Researcher` là contributor theo required role
- contributor claim/join hiện vẫn dựa trên **tên role Discord**:
  - `Technician`
  - `Researcher`

## Phạm vi implementation hiện tại

### Đã implement
- `/ping`
- `/setup`
- `/task create`
- `/task sync-dashboard`
- button workflow:
  - `Claim`
  - `Join Task`
  - `Block`
  - `Unblock`
  - `Done / Review`
  - `Approve`
  - `Request Changes`
  - `Reopen`
  - `Open Workspace`

### Đã có nhưng còn giới hạn MVP
- backend vẫn dùng SQLite
- chỉ phù hợp **single-process / single-instance**
- `archive_channel` đang được cấu hình và hiển thị, nhưng chưa tự động post bản ghi task done vào đó
- chưa có Dockerfile / systemd unit / cloud deployment template đi kèm repo

### Chưa implement / spec-only
- web dashboard riêng
- private workspace theo từng member task
- automated backup
- observability/metrics nâng cao
- CI/test suite hoàn chỉnh

## Kiến trúc tổng quan

```text
src/
  index.ts                         # app entrypoint
  config/
    env.ts                         # env validation
  bot/
    client.ts                      # Discord client setup
    interaction-router.ts          # slash/button/modal routing
    register-commands.ts           # command registration
  lib/
    logger.ts                      # structured console logging
    prisma.ts                      # Prisma singleton
  modules/
    guild-config/                  # /setup + summary config
    tasks/                         # create/sync/interactions/repository/renderer/policy
    threads/                       # workspace thread lifecycle
prisma/
  schema.prisma                    # SQLite schema
  migrations/                      # Prisma migrations
docs/
  guides/                          # vận hành thực tế
  specs/                           # đặc tả thiết kế/kiến trúc
```

## Domain model

Schema chính nằm ở `prisma/schema.prisma`:

- `GuildConfig` — cấu hình từng Discord server
- `Task` — task chính, trạng thái, role, priority, deadline, message/thread refs
- `TaskMember` — thành viên tham gia task
- `TaskStatusHistory` — lịch sử chuyển trạng thái

## Workflow model

### Trạng thái
- `BACKLOG`
- `IN_PROGRESS`
- `BLOCKED`
- `REVIEW`
- `DONE`

### Actor model hiện tại
- `Admin`
  - setup server
  - tạo task
  - sync dashboard
  - override workflow khi cần
  - review / approve / reopen
- `Technician`
  - claim/join task `TECHNICIAN`
  - hỗ trợ quản lý/review theo implementation hiện tại
- `Researcher`
  - claim/join task `RESEARCHER`
  - thực hiện workflow contributor

## Slash command và action reference

### Slash commands

| Command | Mục đích | Ghi chú |
|---|---|---|
| `/ping` | kiểm tra bot online | health check nhanh |
| `/setup` | cấu hình dashboard/feed/admin/reviewer/archive | yêu cầu `Manage Server` |
| `/task create` | tạo task backlog mới | có `team_size`, `priority`, `deadline` |
| `/task sync-dashboard` | repair summary/task cards/threads từ DB | dùng khi Discord bị lệch state |

### Buttons / actions

| Action | Khi xuất hiện | Ghi chú |
|---|---|---|
| `Claim` | task đang `Backlog` | contributor phù hợp hoặc admin override |
| `Join Task` | task `In Progress` / `Blocked` và còn slot | task team model |
| `Block` | task `In Progress` | cần nhập lý do |
| `Unblock` | task `Blocked` | trả về `In Progress` |
| `Done / Review` | task `In Progress` | đưa task sang `Review` |
| `Approve` | task `Review` | đánh dấu `Done` |
| `Request Changes` | task `Review` | trả về `In Progress` |
| `Reopen` | task `Done` | đưa task về `Backlog` |
| `Open Workspace` | task có thread | mở thread làm việc |

## Yêu cầu trước khi chạy

Bạn nên có sẵn:
- Node.js `>=24.0.0`
- npm
- bot Discord đã tạo trong Developer Portal
- bot đã được mời vào server với scopes:
  - `bot`
  - `applications.commands`
- bot có đủ quyền Discord tại channel dashboard/feed/thread
- persistent storage nếu dùng thật với SQLite

## Biến môi trường

Tạo `.env` từ `.env.example`.

| Biến | Bắt buộc | Ví dụ | Dùng cho | Ghi chú |
|---|---|---|---|---|
| `DISCORD_TOKEN` | có | `...` | runtime + register | secret, không commit |
| `CLIENT_ID` | có | `1234567890` | register | Discord Application ID |
| `DATABASE_URL` | có | `file:./dev.db` | Prisma | local mặc định, production nên dùng path persistent rõ ràng |
| `GUILD_ID` | không | `1234567890` | register | nên dùng khi test nhanh trên 1 server |
| `NODE_ENV` | nên có | `development` / `production` | env validation | production nên set rõ `production` |

Ví dụ local development:

```env
DISCORD_TOKEN=your_bot_token_here
CLIENT_ID=your_discord_application_id_here
DATABASE_URL=file:./dev.db
GUILD_ID=your_test_server_id_here
NODE_ENV=development
```

Ví dụ production trên host có persistent storage:

```env
DISCORD_TOKEN=your_bot_token_here
CLIENT_ID=your_discord_application_id_here
DATABASE_URL=file:/opt/taskbot/data/taskbot.db
NODE_ENV=production
```

## Quick start local

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
   - tạo task đầu tiên bằng `/task create`

Nếu PowerShell chặn `npm.ps1`, dùng `npm.cmd` thay cho `npm`.

## Quick start production

TaskBot **không phải web app HTTP**. Hãy deploy như một **background worker / long-running process**, không phải serverless function hay static hosting.

### Mô hình khuyến nghị hiện tại
- 1 VPS hoặc máy luôn bật
- 1 process bot
- PM2 để giữ process sống
- SQLite nằm trên persistent storage

### Quy trình deploy production
1. Clone source code lên host.
2. Tạo `.env` với giá trị production.
3. Cài dependency sạch bằng lockfile:
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
6. Chạy migration production-safe:
   ```bash
   npm run prisma:migrate:deploy
   ```
7. Register slash commands khi cần:
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

### Chạy lâu dài bằng PM2
```bash
pm2 start npm --name taskbot -- run start
pm2 logs taskbot
pm2 restart taskbot
pm2 save
```

## Scripts chính

| Script | Mục đích |
|---|---|
| `npm run dev` | chạy bot ở watch mode |
| `npm run build` | build TypeScript ra `dist/` |
| `npm run start` | chạy bản build production |
| `npm run typecheck` | kiểm tra TypeScript |
| `npm run clean` | xóa `dist/` theo cách cross-platform |
| `npm run register:commands` | register slash commands |
| `npm run prisma:generate` | generate Prisma client |
| `npm run prisma:validate` | validate Prisma schema |
| `npm run prisma:migrate:dev` | migration local development |
| `npm run prisma:migrate:deploy` | migration production |

## Vận hành và an toàn dữ liệu

### SQLite lưu ý cực kỳ quan trọng
- chỉ chạy **1 instance bot**
- không phù hợp scale nhiều replica
- DB file phải nằm trên persistent storage
- backup DB trước khi:
  - deploy
  - migrate schema
  - chuyển host
- không deploy trên môi trường filesystem ephemeral nếu chưa gắn volume bền vững

### Khi nào phải chạy lại `register:commands`
- đổi tên command
- đổi description
- đổi options
- thêm/xóa command
- đổi `GUILD_ID`

## Troubleshooting fast path

Nếu bot gặp lỗi, xử lý nhanh theo thứ tự:
1. test `/ping`
2. kiểm tra log `Logged in as ...`
3. kiểm tra `.env`
4. kiểm tra command đã register chưa
5. kiểm tra quyền bot ở dashboard/feed/thread
6. kiểm tra role `Admin`, `Technician`, `Researcher`
7. nếu Discord bị lệch state, chạy `/task sync-dashboard`

## Giới hạn hiện tại

- backend hiện là SQLite, chưa phải DB multi-instance
- chưa có Dockerfile chính thức
- chưa có systemd service file đi kèm repo
- chưa có backup automation
- chưa có test/lint/CI hoàn chỉnh
- `archive_channel` chưa tự auto-post task done
- contributor claim/join vẫn phụ thuộc vào **tên role Discord** `Technician` và `Researcher`

## Tài liệu liên quan

### Guides
- [01. Thiết lập Discord Server](docs/guides/01-discord-server-setup.md)
- [02. Cài đặt và sử dụng bot](docs/guides/02-bot-setup-and-daily-use.md)
- [03. Hosting và vận hành](docs/guides/03-hosting-and-operations.md)
- [04. Xử lý sự cố và khôi phục](docs/guides/04-troubleshooting-and-recovery.md)

### Specs
- [Discord UX & Workflow Spec](docs/specs/01-discord-ux-workflow.md)
- [Data, Commands, and Permissions Spec](docs/specs/02-data-commands-permissions.md)
- [MVP Code Plan](docs/specs/03-mvp-code-plan.md)

## License / support

`package.json` hiện để `UNLICENSED`.

Hãy coi repo này là dự án private/internal cho tới khi bạn chủ động đổi license và chính sách phát hành.