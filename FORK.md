# Realtime Monitor — quy tắc vận hành fork

Tên tạm: **Realtime Monitor**. Đây là bản fork của [koala73/worldmonitor](https://github.com/koala73/worldmonitor) (AGPL-3.0). Fork bổ sung variant `vietnam` và tự host bằng Docker.

Tên miền thử nghiệm khi chạy cục bộ: `realtime-monitor.localhost`. Trình duyệt tự phân giải `*.localhost` về máy mình, không cần sửa `/etc/hosts`.

## Nhánh

| Nhánh | Vai trò |
|---|---|
| `main` | Theo dõi `upstream/main` nguyên trạng. **Không đẩy lên remote của fork** (xem mục CI). |
| `vn/main` | Nhánh sản phẩm, là nhánh mặc định của repo fork. Mọi PR của fork nhắm vào đây. |
| `vn/pr-*` | Một nhánh cho mỗi PR theo `PHASE-0-1-PLAN` (PR-0a, PR-0b, …). |

Thay đổi riêng cho Việt Nam nên nằm trong file mới hoặc trong khối tách biệt, để việc merge upstream ít xung đột.

## Đồng bộ upstream

1. `git fetch upstream`
2. `git switch main && git merge --ff-only upstream/main` (chỉ cập nhật cục bộ).
3. Tạo nhánh `vn/sync-YYYY-MM-DD` từ `vn/main`, chạy `git merge upstream/main`, giải quyết xung đột, rồi mở PR vào `vn/main`.
4. Sau khi merge, chạy `npm run sources:generate`. Không sửa tay các file sinh ra (theo `CONTRIBUTING.md`, mục "Source attribution ledger").

## CI và GitHub Actions

- Mọi workflow deploy hoặc publish của upstream chỉ chạy khi **push vào `main`** (Convex, Cloudflare Worker, Railway…) hoặc khi **push tag** (`v*`, `cli-v*`, `py-v*`, `gem-v*`, `sdk/go/v*`). Workflow chạy theo lịch đã có điều kiện chặn cho repo khác `koala73/worldmonitor`.
- Vì vậy, chừng nào fork **không đẩy nhánh `main` và không đẩy các tag trên**, Actions trên fork chỉ chạy các bộ kiểm thử của PR (test, typecheck, lint, proto, CodeQL, security audit, e2e visual). Các bộ này không cần secret.
- Fork **không sửa** workflow để chặn deploy. GitHub chạy định nghĩa workflow của chính nhánh được đẩy, nên sửa trên `vn/*` không ngăn được workflow gốc trên `main`. Sửa thêm chỉ tạo xung đột khi merge upstream, và làm hỏng các test hình dạng workflow (`tests/ci-workflow-coverage.test.mts`…).
- Tag phát hành của fork dùng tiền tố riêng: `rm-v*`.
- Chưa kiểm chứng trên GitHub: `contributor-trust.yml` (`pull_request_target`) và `stacked-merge-guard.yml` có thể giả định nhãn hoặc quy ước của upstream. Theo dõi lần chạy PR đầu tiên.

## Nghĩa vụ giấy phép

- Giữ nguyên `LICENSE` (toàn văn AGPL-3.0 và thông báo bản quyền của upstream).
- Bản triển khai cho người khác dùng qua mạng phải chỉ cho họ nơi lấy mã nguồn tương ứng (AGPL §13). Liên kết tới repo này sẽ được thêm vào giao diện ở PR-0b.
- AGPL không cấp quyền dùng tên, logo hay nhận diện "World Monitor" (`docs/trademark-policy.mdx`). PR-0b đổi tên hiển thị và tên miền.

## Lưu ý khi repo nằm trên ổ không phải APFS

Repo hiện ở `/Volumes/ViTu`, một ổ không phải APFS:

- macOS ghi file metadata `._*` cạnh mọi file. `.git/info/exclude` đã bỏ qua `._*` và `.DS_Store`. Nếu git báo `non-monotonic index …/._pack-*.idx`, xóa các file `._*` trong `.git/objects/pack`.
- Đã đặt `git config core.fileMode false`, vì ổ không giữ bit thực thi.
- Ổ có thể không hỗ trợ symlink, nên `npm ci` có thể lỗi ở `node_modules/.bin`. Khi gặp lỗi đó: chạy kiểm thử trong container Docker, hoặc chuyển repo sang ổ APFS.
