# Hoàng Kha Learning — Backend

NestJS, MongoDB replica set, JWT, Cloudinary riêng tư và gửi email qua Brevo HTTPS API hoặc Gmail. Yêu cầu Node.js 24, Yarn 1. Swagger tại `/api/docs`. Bản bàn giao không chứa test, fixtures hoặc dữ liệu demo.

## Chạy ứng dụng

Chạy trong thư mục `server`:

```sh
yarn install --frozen-lockfile
yarn build
yarn start:prod
```

Phát triển: `yarn start:dev`. Kiểm tra mã và build: `yarn verify`.

Điền thông tin thật vào `server/.env` hoặc biến môi trường máy chủ. `.env` được đọc theo vị trí ứng dụng, không phụ thuộc thư mục terminal và không đưa vào Git.

| Biến                    | Ý nghĩa                                                                                                                                                              |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`              | Đặt `production` trên máy chủ chính thức.                                                                                                                            |
| `PORT`                  | Cổng HTTP, mặc định 3000.                                                                                                                                            |
| `MONGODB_URI`           | MongoDB Atlas hoặc replica set, cần hỗ trợ transaction.                                                                                                              |
| `DNS_SERVERS`           | Tùy chọn: IP DNS ngăn cách bằng dấu phẩy, ví dụ `1.1.1.1,8.8.8.8`. Bỏ trống để dùng DNS hệ thống. Chỉ áp dụng trong tiến trình Node.js khi khởi tạo kết nối MongoDB. |
| `JWT_SECRET`            | Khóa JWT, tối thiểu 32 ký tự.                                                                                                                                        |
| `RECEIPT_SECRET`        | Khóa biên nhận, tối thiểu 32 ký tự, khác `JWT_SECRET`; giữ nguyên sau khi đã có bài nộp.                                                                             |
| `FRONTEND_URL`          | Các origin frontend được phép, ngăn cách bằng dấu phẩy; origin đầu tiên dùng trong email.                                                                            |
| `CLOUDINARY_CLOUD_NAME` | Cloud name.                                                                                                                                                          |
| `CLOUDINARY_API_KEY`    | API key thuộc cùng Product Environment.                                                                                                                              |
| `CLOUDINARY_API_SECRET` | API secret tương ứng.                                                                                                                                                |
| `MAIL_PROVIDER`         | `gmail` (mặc định, tương thích cấu hình cũ) hoặc `brevo`. Render Free dùng `brevo`.                                                                                  |
| `BREVO_API_KEY`         | API key của tài khoản Brevo; bắt buộc khi dùng `brevo` trong production. Không dùng SMTP key.                                                                        |
| `MAIL_FROM_EMAIL`       | Email người gửi đã xác minh trong Brevo; bắt buộc khi dùng `brevo` trong production.                                                                                 |
| `GMAIL_USER`            | Địa chỉ Gmail gửi thư; chỉ dùng với `MAIL_PROVIDER=gmail`.                                                                                                           |
| `GMAIL_APP_PASSWORD`    | Mật khẩu ứng dụng Google gồm 16 ký tự; chỉ dùng với `MAIL_PROVIDER=gmail`.                                                                                           |
| `TRUST_PROXY`           | Chỉ đặt `1` sau một reverse proxy tin cậy.                                                                                                                           |

### Brevo HTTPS API cho Render Free

Render Free chặn SMTP nên không dùng Gmail App Password trực tiếp ở môi trường này. `render.yaml` chọn `MAIL_PROVIDER=brevo`; ứng dụng gọi `POST https://api.brevo.com/v3/smtp/email` qua HTTPS, có timeout 15 giây. Không bổ sung hàng đợi hoặc API quản lý email.

1. Tạo tài khoản Brevo Free và xác nhận tài khoản. Nếu Brevo yêu cầu kích hoạt gửi transactional email, hoàn tất bước đó trước khi thử gửi.
2. Trong phần **Senders**, thêm người gửi tên **Hoàng Kha Learning**, nhập địa chỉ email bạn quản lý và xác minh qua email. Khi chưa có tên miền riêng, có thể bắt đầu bằng địa chỉ cá nhân đã xác minh. Brevo có thể thay địa chỉ From bằng địa chỉ thuộc hạ tầng của họ; nên xác thực tên miền riêng khi có để cải thiện nhận diện và khả năng phát thư.
3. Trong **SMTP & API → API Keys**, tạo API key cho backend. Chọn API key, không lấy SMTP key; tên menu có thể thay đổi theo giao diện Brevo.
4. Đặt `MAIL_PROVIDER=brevo`, `MAIL_FROM_EMAIL` bằng đúng địa chỉ đã xác minh và `BREVO_API_KEY` bằng key vừa tạo trong Render Environment. Không cần `GMAIL_APP_PASSWORD` khi chọn Brevo.

Người nhận trả lời về `MAIL_FROM_EMAIL` qua Reply-To. Brevo Free hiện có giới hạn 300 email/ngày, dùng chung cho các lần cấp tài khoản, đặt lại mật khẩu và gửi biên nhận; kiểm tra quota và trạng thái gửi trong Brevo khi thư chưa tới. `emailSent` chỉ biểu thị dịch vụ đã nhận yêu cầu, không bảo đảm thư nằm trong inbox. Không tự gửi lại email khi timeout để tránh gửi trùng; các luồng thử lại hiện có vẫn được giữ.

Tài liệu: [Render chặn SMTP trên Free](https://render.com/changelog/free-web-services-will-no-longer-allow-outbound-traffic-to-smtp-ports), [Brevo transactional API](https://developers.brevo.com/reference/send-transac-email), [xác minh sender](https://help.brevo.com/hc/en-us/articles/208836149-Create-a-new-sender-From-name-and-From-email), [giới hạn Free](https://help.brevo.com/hc/en-us/articles/208580669-FAQs-What-are-the-limits-of-the-Free-plan), [địa chỉ gửi thay thế](https://help.brevo.com/hc/en-us/articles/14925263522578-Comply-with-Gmail-Yahoo-and-Microsoft-s-requirements-for-email-senders).

### Gmail cho máy local hoặc hosting cho phép SMTP

1. Bật xác minh hai bước cho tài khoản Google dùng để gửi thư.
2. Mở [Mật khẩu ứng dụng](https://myaccount.google.com/apppasswords), tạo mật khẩu cho ứng dụng nộp bài.
3. Điền địa chỉ gửi vào `GMAIL_USER`, mật khẩu vừa tạo vào `GMAIL_APP_PASSWORD` trong `server/.env`.
4. Khởi động lại server. Không dùng mật khẩu đăng nhập Gmail thông thường.

Google yêu cầu xác minh hai bước để dùng mật khẩu ứng dụng; một số tài khoản tổ chức có thể không có lựa chọn này. Xem [hướng dẫn Google](https://support.google.com/accounts/answer/185833).

Ứng dụng dùng cấu hình Gmail có sẵn của Nodemailer; không cần khai báo host, port hoặc địa chỉ gửi riêng. Khi chưa đặt `MAIL_PROVIDER`, cấu hình cũ tiếp tục dùng Gmail. Production kiểm tra đủ các biến của dịch vụ được chọn; cấu hình Gmail không phải điều kiện khởi động khi dùng Brevo. Khi phát triển, nếu dịch vụ được chọn chưa có cấu hình, API học tập vẫn chạy nhưng yêu cầu nộp bài mới trả `503 MAIL_NOT_CONFIGURED` trước khi upload file.

## Triển khai Render + Vercel

Repo backend hiện tại là `hoangkha442/be_qlstc`, có `package.json` ngay ở gốc. Trên Render chọn **New → Web Service**, kết nối repo rồi đặt:

| Thiết lập         | Giá trị                                                                                                 |
| ----------------- | ------------------------------------------------------------------------------------------------------- |
| Name              | `hoang-kha-learning-api` hoặc tên còn trống                                                             |
| Branch            | `master`                                                                                                |
| Root Directory    | Để trống với repo backend riêng này. Chỉ đặt `server` nếu sau này deploy từ monorepo có thư mục server. |
| Runtime           | Node                                                                                                    |
| Instance          | Free                                                                                                    |
| Build Command     | `yarn install --frozen-lockfile --production=false && yarn build`                                       |
| Start Command     | `yarn start:prod`                                                                                       |
| Health Check Path | `/api/health`                                                                                           |

Biến môi trường cần nhập trên Render:

- `NODE_ENV=production`, `NODE_VERSION=24.22.1`, `TRUST_PROXY=1`, `MAIL_PROVIDER=brevo`.
- `MONGODB_URI`: MongoDB Atlas hỗ trợ transaction. Trong Atlas Network Access, thêm các CIDR ở Render **Connect → Outbound**; không cần mở toàn bộ IP chỉ để triển khai.
- `JWT_SECRET`, `RECEIPT_SECRET`: ít nhất 32 ký tự và khác nhau. **Nếu dùng database hiện tại, giữ các khóa đang dùng, đặc biệt `RECEIPT_SECRET` để tra cứu các bài đã nộp.** Blueprint yêu cầu nhập `RECEIPT_SECRET`, không tự tạo khóa thay thế cho database cũ.
- `FRONTEND_URL=https://hoangkha-learning.vercel.app`: origin HTTPS của frontend, không có dấu `/` cuối hoặc đường dẫn. Nếu nhiều origin, ngăn cách dấu phẩy và để địa chỉ production đầu tiên vì email dùng địa chỉ đó. Khi chạy local có thể dùng `https://hoangkha-learning.vercel.app,http://localhost:5173`. Vercel preview có origin riêng; chỉ thêm origin cần dùng, không thay bằng ký tự `*`.
- `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`: cùng Product Environment, dùng giá trị thật của hệ thống.
- `BREVO_API_KEY`, `MAIL_FROM_EMAIL`: cấu hình theo phần Brevo phía trên.

Render tự cung cấp `PORT`; server đã đọc biến này và lắng nghe `0.0.0.0`. Không chạy seed trong build hoặc start. Nếu đã dùng MongoDB cũ thì giữ tài khoản/dữ liệu cũ; nếu database mới chưa có giảng viên, chạy lệnh provision có chủ đích theo phần Tài khoản giảng viên.

Sau deploy, mở URL thật của service kèm `/api/health`; kết quả cần có `status: ok` và `database: connected`. Sau đó trong Vercel Environment đặt `VITE_API_URL` bằng **URL backend thật + `/api`** và redeploy frontend vì Vite lấy giá trị khi build. Cập nhật `FRONTEND_URL` trên Render bằng domain Vercel production thực tế nếu khác giá trị ban đầu. `.env` local không tự chuyển sang Render và không đưa key backend vào biến frontend.

Nếu email cấp tài khoản, đặt lại mật khẩu hoặc biên nhận vẫn chứa `localhost`, mở service backend trên Render → Environment và sửa `FRONTEND_URL=https://hoangkha-learning.vercel.app`, rồi lưu và redeploy. Link đăng nhập trong email mới sẽ là `https://hoangkha-learning.vercel.app/specialized/login`, link tra cứu là `https://hoangkha-learning.vercel.app/lookup`. Email đã gửi giữ nội dung cũ. Không đặt lại mật khẩu chỉ để sửa link; sinh viên có thể đăng nhập tại URL mới bằng thông tin của email còn hiệu lực.

`render.yaml` dùng cho Blueprint của repo backend riêng; có thể dùng nó hoặc nhập các giá trị tương đương trong Dashboard. Tham khảo [Web Services](https://render.com/docs/web-services), [Node version](https://render.com/docs/node-version), [Outbound IP](https://render.com/docs/outbound-ip-addresses).

## Tài khoản giảng viên

Không có đăng ký công khai. Đăng nhập bằng `POST /api/auth/login`, hồ sơ qua `GET /api/auth/me`.

Để cấp tài khoản giảng viên đầu tiên, điền `SEED_LECTURER_EMAIL`, `SEED_LECTURER_NAME`, `SEED_LECTURER_PASSWORD`, rồi chạy `yarn provision:lecturer`. Mật khẩu cần ít nhất 12 ký tự và tối đa 72 byte. Lệnh chỉ tạo tài khoản khi chưa tồn tại, không tạo học kỳ/bài tập minh họa và không ghi đè mật khẩu tài khoản đã có.

Mọi API `/api/lecturer/*` yêu cầu JWT giảng viên, chỉ thao tác dữ liệu của giảng viên đó. JWT sinh viên không dùng được các API này.

## Hai danh mục

`GET /api/public/categories` trả hai nhóm ổn định:

| `code`        | Danh mục          | Truy cập                                                     |
| ------------- | ----------------- | ------------------------------------------------------------ |
| `general`     | Đại cương         | Công khai, dùng API học kỳ, lớp, học phần, bài tập hiện tại. |
| `specialized` | Chuyên ngành CNTT | Đăng nhập sinh viên, dùng API lộ trình riêng.                |

Lộ trình Chuyên ngành lưu riêng, không xuất hiện trong danh sách bài tập công khai của Đại cương. Giảng viên tự tạo nội dung thật; ứng dụng không tự thêm môn học hoặc lộ trình khi khởi động.

## Đại cương và nộp bài

| Nhóm                   | API                                                                                             |
| ---------------------- | ----------------------------------------------------------------------------------------------- |
| Công khai              | `GET /api/public/semesters`, `/classes`, `/course-sections`, `/assignments`, `/assignments/:id` |
| Quản lý                | `GET/POST /api/lecturer/semesters`, `/subjects`, `/classes`, `/course-sections`, `/assignments` |
| Sửa/lưu trữ            | `PATCH /api/lecturer/<tài-nguyên>/:id`, `PATCH .../:id/archive`                                 |
| Tổng quan              | `GET /api/lecturer/dashboard`                                                                   |
| Nộp bài                | `POST /api/public/assignments/:id/submissions`                                                  |
| Tra cứu                | `POST /api/public/receipts/lookup`                                                              |
| Sinh viên tải lại file | `POST /api/public/receipts/file`                                                                |
| Quản lý bài nộp        | `GET /api/lecturer/submissions`, `/submissions/:id`, `/submissions/:id/file`                    |
| Xuất dữ liệu           | `GET /api/lecturer/assignments/:id/submissions.zip`, `/submissions.xlsx`                        |

Nộp bài dùng `multipart/form-data`: `studentCode`, `fullName`, **`email` bắt buộc**, `note` tùy chọn, `secret` khi nộp lại và `files`. Header `Idempotency-Key` là chuỗi ngẫu nhiên 20–100 ký tự. Giữ nguyên key, email, thông tin và file khi thử lại cùng yêu cầu; dùng key mới khi chủ động nộp phiên bản tiếp theo.

Email được chuẩn hóa chữ thường và kiểm tra định dạng. Sinh viên Đại cương không cần tài khoản: chỉ nhập thông tin, email và file để nộp bài; nhận mã xem lại bài qua email. Mỗi phiên bản lưu email riêng. Bài cũ vẫn tra cứu được, `email` có thể là `null`; không tự gửi thư hồi tố.

Giới hạn: tối đa 10 file, 10 MiB/file, tùy quy định từng bài. Cả Đại cương và Chuyên ngành dùng `allowedExtensions` tùy chỉnh (1–64 phần mở rộng), `maxFiles` và `maxFileBytes`. Ví dụ: Office, ảnh, PDF, ZIP/RAR/7z, TXT/CSV, HTML/CSS/JS hoặc phần mở rộng tự nhập. Các giá trị được chuẩn hóa chữ thường, bỏ dấu chấm đầu và loại trùng; hỗ trợ đuôi ghép như `tar.gz`. Khi tạo mới, giảng viên phải chọn định dạng rõ ràng; API không mặc định Office/ảnh hoặc ZIP. Thiếu hoặc để trống `allowedExtensions` bị từ chối, kể cả bài tạo trong chương/bài học. `maxFiles` mặc định 10 nếu không truyền; có thể chọn từ 1 đến 10. Bài cũ giữ nguyên quy định, giảng viên sửa và lưu để thay đổi định dạng hoặc nâng số file. PATCH bỏ qua `allowedExtensions` vẫn giữ lựa chọn hiện tại.

Chọn ZIP cũng cho phép sinh viên chọn nguyên thư mục ở client. Thư mục được nén trong trình duyệt, giữ cấu trúc, tự loại `node_modules`/`.git`, rồi gửi như một file ZIP qua API hiện tại. Giới hạn trước nén: 5.000 file, 20 MiB/file và tổng 100 MiB; ZIP kết quả vẫn phải nằm trong `maxFileBytes`. Folder không được gửi dưới dạng đường dẫn máy sinh viên.

ZIP được kiểm CRC/nội dung, từ chối đường dẫn nguy hiểm, symlink, file trùng, mã hóa, thư mục phụ thuộc và giải nén quá mức. ZIP có thể chứa tài liệu hoặc mã nguồn, cần ít nhất một file có nội dung. PDF và các archive phổ biến được kiểm dấu hiệu định dạng; các định dạng văn bản được kiểm nội dung văn bản/JSON khi phù hợp. Định dạng tự nhập khác được lưu nguyên dưới dạng private attachment, không chạy hoặc render trên server. Toàn bộ file tải qua API với Content-Disposition attachment và application/octet-stream.

Backend kiểm tra cấu trúc Office và giải mã ảnh thật bằng Sharp; từ chối ảnh hỏng, đổi đuôi sai nội dung hoặc vượt giới hạn 40 triệu điểm ảnh/250 khung hình. File ảnh vẫn giữ nguyên nội dung gốc, tên và phần mở rộng khi lưu/tải; không chuyển đổi ảnh. Office vẫn bị từ chối khi có macro, mã hóa hoặc nội dung không hợp lệ. Kiểm tra lại thời gian và quy định bài tập khi upload hoàn tất. File Cloudinary dùng raw/private, cùng luồng biên nhận, lịch sử và xuất ZIP hiện tại. Không cần thay đổi biến môi trường cho tính năng ảnh.

Tra cứu cần body `receiptCode`, `secret`. Tải file cần thêm `version` là số nguyên từ 1 và `fileIndex` từ 0. Mã bí mật truyền trong body, không đưa vào URL. API tải file trả nội dung đính kèm, không lộ URL Cloudinary.

Response nộp bài có `emailSent` boolean và `message`. `emailSent: true` nghĩa là dịch vụ email đã nhận yêu cầu gửi thư. Nếu `false`, bài vẫn đã lưu thành công; sinh viên có thể lưu mã ngay trên màn hình hoặc thử lại cùng yêu cầu để gửi lại email. API tra cứu chỉ đọc bài, không gửi email.

### Nộp lại khi gửi nhầm file

Nộp lại dùng cùng API nộp bài, tạo một phiên bản mới với `Idempotency-Key` mới. Đại cương phải có mã bí mật của bài cũ; Chuyên ngành phải là tài khoản sở hữu bài nộp, không nhập mã bí mật. Mỗi phiên bản mới chứa toàn bộ file thay thế, không ghép với file cũ. File và điểm của các phiên bản cũ được giữ; phiên bản mới chưa có điểm. Đại cương tiếp tục nhận email biên nhận sau lần nộp lại theo cấu hình hiện tại.

Biên nhận/tra cứu Đại cương và bài nộp cá nhân Chuyên ngành trả thêm `resubmission: { allowed, reason }` dựa trên quyền `allowResubmit`, thời gian mở/hạn nộp, `allowLate`, đóng thủ công và lưu trữ hiện tại. Không tự bật quyền nộp lại cho bài tập cũ. Giảng viên bật Cho nộp lại trong Sửa bài tập; nếu đã hết hạn phải điều chỉnh hạn hoặc cho nộp trễ. Server vẫn kiểm tra lại quyền, thời gian và file khi upload hoàn tất. Thử lại một yêu cầu đã lưu bằng cùng key không tạo thêm phiên bản, kể cả khi bài vừa đóng.

### Tổng hợp tiến độ nộp bài Đại cương

- `GET /api/lecturer/submission-summary`: tổng quan và danh sách sinh viên có phân trang.
- `GET /api/lecturer/submission-summary/students/:studentCode`: danh sách từng bài tập, trạng thái và metadata bài nộp mới nhất của MSSV.
- `GET /api/lecturer/submission-summary/export.xlsx`: xuất toàn bộ sinh viên khớp bộ lọc, không áp dụng phân trang.

Cả ba yêu cầu JWT giảng viên và `classId`. Bộ lọc phạm vi tùy chọn: `semesterId`, `courseSectionId`, `includeArchived` (`'true'`/`'false'`, mặc định `'false'`). Học phần phải thuộc lớp và học kỳ đã chọn; mọi dữ liệu giới hạn theo giảng viên sở hữu. Có thể tổng hợp lớp/học phần cũ đã lưu trữ. Hai API danh sách/Excel nhận thêm `search` (tối đa 100 ký tự, tìm MSSV/tên/email, hỗ trợ tên bỏ dấu), `status` (`all`, `complete`, `incomplete`), `page` và `limit` (tối đa 100); `page`/`limit` không giới hạn số dòng Excel. API chi tiết chỉ nhận các bộ lọc phạm vi.

Tổng bài tập gồm tất cả bài Đại cương trong các học phần thuộc phạm vi, mặc định bỏ bài đã lưu trữ, bao gồm cả bài chưa mở. Bài đã nộp tính theo giao của tập ID bài tập và các bài nộp có `latestVersion > 0`; mỗi bài chỉ tính một lần, không cộng các lần nộp lại. MSSV được gộp xuyên học phần trong cùng phạm vi. `missingAssignments` là tổng bài trừ số bài đã nộp; `overdueAssignments` chỉ tính bài còn thiếu đã qua `dueAt`. `completionRate` là số từ 0 đến 1 hoặc null khi tổng bài bằng 0; trường hợp 0/0 không tính đã nộp đủ.

Đại cương chưa quản lý danh sách lớp. Danh sách thống kê gồm MSSV từng nộp bài hoàn tất trong phạm vi được chọn, bao gồm người chỉ từng nộp bài lưu trữ nên hiện có thể là 0/N. Không suy ra được sinh viên chưa từng nộp bài. Response có `coverageNotice`; không trả mã bí mật hoặc metadata lưu trữ file. Tên/email và lần nộp cuối lấy từ bài nộp gần nhất trong phạm vi. `overview` không bị giới hạn bởi tìm kiếm/lọc tiến độ/phân trang; `items` và `total` phản ánh các bộ lọc đó.

Tính toán dùng aggregation phía MongoDB và index `(lecturerId, courseSectionId, latestVersion)`. Excel truyền theo luồng, gồm sheet Phạm vi và Tổng hợp sinh viên. Không gửi email, không thay đổi bài nộp hoặc điểm và không cần biến môi trường mới. Khởi động server áp dụng index như các schema hiện có.

### Chấm điểm và xem kết quả

Giảng viên chấm từng phiên bản bài nộp bằng `PATCH /api/lecturer/submissions/:id/grade`, dùng được cho cả Đại cương và Chuyên ngành. Body gồm `version` (từ 1), `score` (0–10, tối đa 2 số thập phân), `feedback` tùy chọn (tối đa 5000 ký tự), `sendEmail` tùy chọn (boolean, mặc định false) và `expectedRevision` (0 khi chưa chấm, hoặc `grade.revision` hiện tại khi sửa). Chỉ giảng viên sở hữu bài nộp được chấm. Sửa từ dữ liệu cũ trả 409 để tránh ghi đè điểm vừa được cập nhật; tải lại chi tiết trước khi chấm tiếp.

Điểm được lưu vào phiên bản, có thời gian chấm và người chấm. Phiên bản nộp lại bắt đầu chưa chấm; điểm phiên bản cũ được giữ. Danh sách bài nộp trả `grade` của phiên bản mới nhất; chi tiết, biên nhận và lịch sử trả điểm từng phiên bản. `grade` là null khi chưa chấm. Excel xuất thêm điểm, nhận xét và ngày chấm của phiên bản mới nhất; điểm 0 được giữ.

Điểm công khai cho đúng sinh viên ngay sau khi lưu, không phụ thuộc chọn gửi email. Đại cương dùng `POST /api/public/receipts/lookup` với mã biên nhận và mã bí mật. Chuyên ngành dùng tài khoản được ghi danh để mở bài tập, xem `GET /api/student/assignments/:id/submission`, không cần mã bí mật. Không có API công khai để tìm điểm bằng MSSV/email.

Chỉ gửi email khi `sendEmail=true`, tới email của phiên bản đang chấm; email chứa bài tập, phiên bản, điểm, nhận xét và link Vercel tương ứng. Đại cương vẫn dùng mã bí mật trong email biên nhận cũ khi tra cứu; email báo điểm không đặt mã bí mật trong URL. Email gửi qua nhà cung cấp đang chọn. Response có `emailRequested`, `emailSent`, `message`; lỗi gửi thư hoặc thiếu email không làm mất điểm đã lưu. Có thể mở Sửa điểm, chọn gửi email rồi lưu lại để chủ động gửi; không tự gửi nền hoặc gửi khi tra cứu. Không cần biến môi trường mới.

### Gửi mã xem lại bài

Backend lưu bài nộp thành công trước, sau đó gửi email qua dịch vụ được chọn trong cùng yêu cầu HTTP. Lỗi email không xóa bài hoặc tạo thêm phiên bản bài nộp. Không có bảng hàng đợi, tác vụ nền hoặc API quản lý email cho Đại cương.

Email chứa MSSV, họ tên, học kỳ/năm học, lớp, môn, học phần, tên bài, phiên bản, thời gian Việt Nam, đúng/trễ hạn, danh sách file, mã biên nhận, mã bí mật và liên kết `/lookup`. Sinh viên dùng hai mã này để xem lại thông tin và tải file, không cần đăng nhập. Không đính kèm file bài nộp hoặc URL Cloudinary. Mã bí mật được khôi phục khi gửi từ `RECEIPT_SECRET`, không lưu plaintext. HTML của dữ liệu nhập được escape. Giữ kín email này.

Thử lại cùng `Idempotency-Key` và nội dung sẽ trả lại bài đã lưu và gửi lại email tới địa chỉ của phiên bản đó; không tạo phiên bản mới. Có thể nhận lại cùng mã qua nhiều email nếu thử lại nhiều lần. Không tự gửi lại ở nền hoặc gửi thư cũ từ collection email của bản trước.

Client đã có input email, xác nhận địa chỉ nhận mã, xử lý `emailSent` và nút gửi lại mã khi gửi thư gặp lỗi. Email nằm trong fingerprint phía client. Trang tra cứu và biên nhận tải file bằng POST với mã bí mật trong body. Xem [hướng dẫn client](../client/README.md).

## Chuyên ngành

### Tài khoản sinh viên

| Thao tác                              | API                                              |
| ------------------------------------- | ------------------------------------------------ |
| Danh sách / cấp tài khoản             | `GET/POST /api/lecturer/students`                |
| Sửa tên/email, khóa hoặc mở tài khoản | `PATCH /api/lecturer/students/:id`               |
| Đặt lại mật khẩu                      | `POST /api/lecturer/students/:id/reset-password` |
| Đăng nhập                             | `POST /api/student/auth/login`                   |
| Hồ sơ                                 | `GET /api/student/auth/me`                       |
| Đổi mật khẩu                          | `POST /api/student/auth/change-password`         |
| Đăng xuất các phiên                   | `POST /api/student/auth/logout`                  |

Cấp tài khoản cần `username`, `studentCode`, `fullName`, `email`. Username không phân biệt hoa/thường, duy nhất toàn hệ thống; MSSV duy nhất trong phạm vi giảng viên. Khi tạo hoặc đặt lại mật khẩu, hệ thống gửi email gồm liên kết `/specialized/login` trên origin đầu tiên của `FRONTEND_URL`, tên đăng nhập và mật khẩu tạm. Mật khẩu chỉ lưu bcrypt, không trả plaintext qua API. Response có `student`, `emailSent`, `message`. Nếu dịch vụ email chưa được cấu hình, dừng trước khi tạo/đổi tài khoản. Nếu gửi lỗi sau khi lưu, tài khoản vẫn tồn tại; sửa cấu hình email rồi đặt lại mật khẩu để gửi email mới. Sinh viên dùng email cấp lại mới nhất.

Đăng nhập bằng `username`, `password`; trả JWT 8 giờ và `student.mustChangePassword`. Khi cờ này là `true`, chỉ được xem hồ sơ, đổi mật khẩu hoặc đăng xuất; API học trả `403 PASSWORD_CHANGE_REQUIRED`. Đổi mật khẩu cần `currentPassword`, `newPassword` tối thiểu 12 ký tự, tối đa 72 byte, khác mật khẩu cũ; response cấp JWT mới. Mật khẩu lưu bcrypt. Đổi/đặt lại mật khẩu, khóa/mở tài khoản, đăng xuất thu hồi các phiên cũ.

Không có đăng ký sinh viên hoặc tự ghi danh công khai. Sinh viên chỉ thấy lộ trình của giảng viên cấp tài khoản. Giảng viên bị khóa cũng chặn quyền học của sinh viên thuộc giảng viên đó.

### Nội dung và ghi danh

Lộ trình → chương → bài học. Mỗi cấp có `published`, `archived` riêng, mặc định là bản nháp. `order` sắp tăng dần rồi theo ID. Lưu trữ không xóa ghi danh hoặc tiến độ.

| Thao tác                    | API                                                                 |
| --------------------------- | ------------------------------------------------------------------- |
| Danh sách / tạo lộ trình    | `GET/POST /api/lecturer/learning-paths`                             |
| Chi tiết kèm chương/bài     | `GET /api/lecturer/learning-paths/:id`                              |
| Cập nhật / lưu trữ lộ trình | `PATCH /api/lecturer/learning-paths/:id`, `PATCH .../:id/archive`   |
| Tạo chương                  | `POST /api/lecturer/learning-paths/:id/modules`                     |
| Cập nhật / lưu trữ chương   | `PATCH /api/lecturer/learning-modules/:id`, `PATCH .../:id/archive` |
| Tạo bài                     | `POST /api/lecturer/learning-modules/:id/lessons`                   |
| Cập nhật / lưu trữ bài      | `PATCH /api/lecturer/lessons/:id`, `PATCH .../:id/archive`          |
| Danh sách ghi danh          | `GET /api/lecturer/learning-paths/:id/enrollments`                  |
| Cấp/thu hồi ghi danh        | `POST /api/lecturer/learning-paths/:id/enrollments`                 |

Lộ trình có tiêu đề, slug, tóm tắt, mô tả, mục tiêu, yêu cầu đầu vào, cấp độ và ảnh bìa. Bài học có tiêu đề, tóm tắt, nội dung, video, thời lượng, tài liệu, `isPreview`, thứ tự và công bố. Văn bản có thể chứa Markdown; frontend cần render an toàn, không chèn HTML chưa lọc.

Tài liệu là liên kết HTTPS trong `resources`: `title`, `url`, `kind` (`document`, `source_code`, `link`). Video dùng `videoUrl` HTTPS từ nơi lưu video/nền tảng phát; backend không tải hoặc chuyển mã video. Xóa video bằng `removeVideo: true`, xóa tài liệu bằng `resources: []`. Quyền riêng tư của URL ngoài hệ thống phụ thuộc nhà cung cấp lưu trữ; API chỉ cấp URL cho tài khoản đủ quyền.

Ghi danh cần `studentId`, `active` mặc định `true`; gọi lại cùng sinh viên/lộ trình cập nhật bản ghi cũ. Đặt `active: false` để thu hồi. Chỉ ghi danh sinh viên thuộc giảng viên quản lý lộ trình.

### File tài liệu bài học

API tạo `POST /api/lecturer/learning-modules/:id/lessons` và sửa `PATCH /api/lecturer/lessons/:id` nhận JSON như cũ hoặc multipart: một trường `data` chứa JSON DTO và các trường `files` chứa file mới. Có thể lưu cùng nội dung, video, liên kết tài liệu và bài tập. Giới hạn tổng cộng 10 file/bài học, 10 MiB/file. Hỗ trợ Office, PDF, JPG/JPEG/PNG/WebP/GIF/AVIF/TIF/TIFF, ZIP/RAR/7z/TAR/GZ/TAR.GZ và các file văn bản/mã nguồn phổ biến; danh sách ở `src/learning/lesson-files.ts`. Backend kiểm nội dung bằng bộ kiểm Office/ảnh/tài liệu hiện có; RAR/7z kiểm chữ ký, không giải nén trên server.

Khi sửa, `keepFileIds` là mảng UUID file hiện có cần giữ. Bỏ trường này giữ toàn bộ file cũ; `[]` gỡ hết file cũ. File mới được thêm vào danh sách giữ lại. ID không thuộc bài học bị từ chối. Không nhận metadata Cloudinary từ client. `resources` tiếp tục là danh sách liên kết HTTPS, còn `files` trả về metadata `id`, `originalName`, `bytes`, `format`, `uploadedAt`; không trả URL lưu trữ riêng tư.

- Giảng viên tải/xem: `GET /api/lecturer/lessons/:id/files/:fileId`.
- Sinh viên tải/xem: `GET /api/student/lessons/:id/files/:fileId`.

Các API file yêu cầu JWT đúng vai trò. Giảng viên phải sở hữu bài học; sinh viên phải đang ghi danh, đã đổi mật khẩu và lộ trình/chương/bài đều đã công bố, chưa lưu trữ. Chế độ xem trước không cấp tài liệu. File được lưu dạng raw/private trên Cloudinary và truyền qua backend.

Ý định upload và việc gỡ file được ghi vào collection `lessonFileCleanup`. Sau thời gian chờ 15 phút, tác vụ nền kiểm tra tham chiếu rồi dọn file không còn sử dụng; lỗi dọn được thử lại, không xóa file đang gắn với bài học. Điều này xử lý cả upload dở dang, lỗi lưu DB và khởi động lại server. Lưu trữ bài học vẫn giữ file. Không cần biến môi trường mới; khởi động backend sẽ tạo schema/index cho collection mới.

### API học

| Thao tác               | API                                       |
| ---------------------- | ----------------------------------------- |
| Lộ trình đã công bố    | `GET /api/student/learning-paths`         |
| Lộ trình và đề cương   | `GET /api/student/learning-paths/:id`     |
| Nội dung bài           | `GET /api/student/lessons/:id`            |
| Đánh dấu/bỏ hoàn thành | `PATCH /api/student/lessons/:id/progress` |

Mọi API yêu cầu JWT sinh viên đã đổi mật khẩu; JWT giảng viên không thay thế được. Lộ trình/chương/bài chưa công bố hoặc đã lưu trữ không hiển thị.

Sinh viên đăng nhập được xem đề cương và nội dung/video bài `isPreview: true` trước khi ghi danh. Tài liệu chỉ trả khi được ghi danh. Bài thường yêu cầu ghi danh. Không có preview công khai. Thu hồi ghi danh chặn nội dung đầy đủ, vẫn giữ quyền xem trước của tài khoản còn hoạt động.

Đề cương chỉ trả metadata, không lộ nội dung hoặc URL video/tài liệu bị khóa. Chi tiết lộ trình có `enrolled`, `totalLessons`, `completedLessons`, `progressPercent`. Cập nhật tiến độ cần `completed` boolean và ghi danh; đây là trạng thái tự đánh dấu, không phải chứng nhận xem hết video hoặc kết quả chấm.

Danh sách hỗ trợ `page`, `limit` tối đa 100, `search`; bộ lọc cụ thể xem Swagger. Lưu trữ dùng body `archived` boolean, công bố dùng `published` boolean. Không chuyển chương/bài sang lộ trình khác để giữ liên kết tiến độ.

### Bài tập mã nguồn

| Thao tác                        | API                                                                        |
| ------------------------------- | -------------------------------------------------------------------------- |
| Giảng viên: danh sách bài tập   | `GET /api/lecturer/specialized/assignments`                                |
| Tạo bài tập cho lộ trình        | `POST /api/lecturer/learning-paths/:id/assignments`                        |
| Tạo bài tập gắn với chương      | `POST /api/lecturer/learning-modules/:id/assignments`                      |
| Tạo bài tập gắn với bài học     | `POST /api/lecturer/lessons/:id/assignments`                               |
| Sửa / lưu trữ                   | `PATCH /api/lecturer/specialized/assignments/:id`, `PATCH .../:id/archive` |
| Danh sách bài nộp mã nguồn      | `GET /api/lecturer/specialized/submissions`                                |
| Sinh viên: bài tập của lộ trình | `GET /api/student/learning-paths/:id/assignments`                          |
| Chi tiết bài tập / bài đã nộp   | `GET /api/student/assignments/:id`, `GET .../:id/submission`               |
| Nộp ZIP                         | `POST /api/student/assignments/:id/submissions`                            |
| Tải phiên bản của chính mình    | `GET /api/student/submissions/:id/file?version=1&fileIndex=0`              |

Bài tập mã nguồn có thể ở cấp lộ trình, chương hoặc bài học. `moduleId` và `lessonId` lưu trên bài tập; khi gắn với bài học, server tự xác định chương. Nếu gửi cả hai ID, chúng phải khớp nhau. Chương/bài học phải đang sử dụng, cùng lộ trình và thuộc giảng viên tạo bài tập. Các bài tập cũ không có liên kết chương/bài học tiếp tục ở cấp lộ trình.

Các API tạo hoặc sửa chương/bài học nhận thêm hai trường tùy chọn:

| Trường          | Hành vi                                                                                                                                                                                    |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `assignments`   | Mảng tối đa 20 bài tập mới: `title`, `opensAt`, `dueAt`, tùy chọn `instructions`, `manuallyClosed`, `allowLate`, `allowResubmit`. Server gắn tự động vào chương/bài học đang tạo hoặc sửa. |
| `assignmentIds` | Mảng tối đa 50 ID bài tập mã nguồn đã có, không trùng, chưa lưu trữ và trong cùng lộ trình. Chuyển liên kết của những bài tập này sang chương/bài học hiện tại, giữ ID và lịch sử nộp.     |

Có thể gửi cả hai trường để vừa tạo mới vừa liên kết bài tập có sẵn. Việc lưu chương/bài học, tạo bài tập và cập nhật liên kết dùng cùng transaction: nếu bất kỳ bài tập hoặc liên kết nào không hợp lệ, toàn bộ thao tác được hoàn tác. Các mảng bị bỏ qua hoặc rỗng không gỡ bài tập đang liên kết. Body bài tập lồng nhau và hai API tạo trực tiếp dưới chương/bài học không nhận ID cha do client tự truyền.

Khi tạo từ trang bài tập qua `POST /api/lecturer/learning-paths/:id/assignments`, gửi thêm `moduleId` hoặc `lessonId` để chọn nơi liên kết. Sửa liên kết qua `PATCH /api/lecturer/specialized/assignments/:id` với `moduleId` (gắn vào chương, gỡ liên kết bài học cũ) hoặc `lessonId` (gắn vào bài học, tự xác định chương). `removePlacement: true` gỡ cả hai liên kết và đưa bài tập về cấp lộ trình; không gửi cùng ID cha. Thay đổi liên kết không tạo lại bài tập hoặc xóa các phiên bản đã nộp.

Danh sách bài tập giảng viên/sinh viên hỗ trợ lọc `moduleId`, `lessonId` bên cạnh `pathId`. Lọc theo chương bao gồm cả bài tập của các bài học trong chương đó. Chi tiết lộ trình trả `assignments` ở cấp gốc, `modules[].assignments` cho bài tập cấp chương và `modules[].lessons[].assignments` cho bài tập cấp bài học. Chi tiết bài học của sinh viên cũng trả `assignments`. Mỗi bài tập kèm trạng thái mở/hết hạn/đóng.

Sinh viên chỉ nhận bài tập khi đã ghi danh và cả lộ trình, chương, bài học liên quan đều được công bố, chưa lưu trữ. Quyền xem trước bài học không bao gồm bài tập. Ẩn/lưu trữ chương hoặc bài học chặn cả xem bài tập, nộp mới, thử lại và tải file đã nộp qua API sinh viên; dữ liệu vẫn được giữ để giảng viên quản lý và có thể khôi phục khi công bố lại. Quyền chương/bài học được kiểm tra lại trong transaction sau khi upload hoàn tất.

Bài tập có tiêu đề, hướng dẫn, thời gian mở/hạn nộp, đóng thủ công, cho nộp trễ hoặc nộp lại. Định dạng/số lượng/dung lượng file do giảng viên cấu hình, gồm khi tạo bài tập trực tiếp hoặc lồng trong chương/bài học. Body multipart gồm `files` (tối đa 10), tùy chọn `note`; cần header `Idempotency-Key`. MSSV, họ tên, email lấy từ tài khoản đã xác thực. Tất cả file được kiểm theo quy định chung phía trên, kể cả PDF, ảnh, ZIP và thư mục đã nén. Quyền ghi danh, hạn nộp, lịch sử, nộp lại và điểm không thay đổi. Không cần biến môi trường hoặc migration mới.

Sinh viên phải được ghi danh đang hoạt động trong lộ trình đã công bố, chưa lưu trữ và đã đổi mật khẩu. Quyền tài khoản/ghi danh/lộ trình được kiểm lại trong transaction sau upload. Phiên bản, khóa chống nộp trùng và dọn file dùng chung cơ chế bài nộp hiện tại. Tra cứu công khai không mở được bài Chuyên ngành; sinh viên chỉ tải bài của mình bằng JWT. Bài ZIP không gửi mã bí mật qua email. Giảng viên dùng API chi tiết/tải file/xuất ZIP/Excel hiện có với quyền sở hữu. Danh sách và thống kê Đại cương loại trừ bài Chuyên ngành.

## Lưu trữ và xử lý sự cố

Nếu khởi động báo `querySrv EBADRESP` hoặc lỗi tra cứu SRV/TXT, kiểm tra DNS trước khi đổi tài khoản MongoDB. Có thể đặt `DNS_SERVERS=1.1.1.1,8.8.8.8` trong `server/.env` rồi khởi động lại. Cấu hình được áp dụng trước khi driver tra cứu Atlas và dùng cả cho lệnh cấp tài khoản giảng viên; không thay đổi DNS của Windows. Máy chủ triển khai có DNS hoạt động bình thường có thể bỏ biến này. Xem [Mongoose FAQ về DNS SRV](https://mongoosejs.com/docs/faq.html).

`yarn check:storage` kiểm tra Cloudinary, không upload/xóa file. Lỗi xác thực trả thông báo cấu hình an toàn. Upload bị từ chối chắc chắn không giữ file chưa tồn tại chờ dọn; upload chưa xác định kết quả được đối soát sau thời hạn để tránh sót file. Không xóa collection hoặc bỏ idempotency khi gặp lỗi.

MongoDB tạo unique index trước khi nhận yêu cầu để bảo vệ username, ghi danh và phiên bản bài. File tải qua API được kiểm tra quyền. Mật khẩu, khóa API, URL ký riêng tư không được ghi vào log. Đăng nhập, nộp bài và tải file có giới hạn tốc độ. `/api/health` kiểm tra kết nối MongoDB.
