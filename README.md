# ROBOT 2027 • V1.2 PRO (Ultra-Light OLED English Learning & Kiosk App)

## Các nâng cấp hoàn thiện trong V1.2 Pro
1. **Thanh Hamburger Góc Trên Bên Phải:** Thu gọn thành 1 nút `☰` duy nhất chống bấm nhầm khi xem YouTube/Game, chạm vào sẽ xổ ngang toàn bộ biểu tượng (`🤖 Học Tiếng Anh`, `▶️ YouTube`, `🎮 Trò chơi`, `🔄 Rảnh tay`, `⚙️ Cài đặt`).
2. **Khóa Kiosk Toàn Màn Hình Ngang (`sensorLandscape`):** Chặn vuốt mép hiện 3 nút điều hướng Android, chặn nút Back và chặn link văng ra trình duyệt/app ngoài. Chạm 5 lần vào góc trên bên trái + nhập mã PIN `2027` để mở khóa quản trị.
3. **Triệt Tiêu Tiếng Kêu "Tít Tít" Của Micro:** Tự động tắt tạm thời kênh âm thanh Thông báo/Hệ thống trong 380ms lúc kích hoạt `SpeechRecognizer`, giữ nguyên âm lượng giọng đọc tiếng Anh/Việt.
4. **Chống Mất Mic Khi Đổi Tab YouTube / Game:** Tự động hủy và khởi tạo mới `SpeechRecognizer` kèm xin lại `AudioFocus` mỗi khi quay về màn hình Robot.
5. **Nhận Diện Lệnh Giọng Nói Song Ngữ Tức Thì (`onPartialResults`):** Bắt chuẩn cả tiếng Anh lẫn phiên âm tiếng Việt (*"xem YouTube"*, *"chơi game"*, *"học tiếng Anh"*, *"dịch nghĩa"*, *"đọc lại"*, *"bỏ qua"*).
6. **Chấm Điểm Phát Âm Từng Từ & Chạm Nghe Chậm:** Tô màu xanh/đỏ từng từ, chạm vào từ bất kỳ để nghe đọc chậm `0.72x`, hỗ trợ 6 chủ đề + 3 cấp độ + tự lưu câu hay sai để ôn tập.

## Hướng dẫn cập nhật & Build APK trên GitHub
1. Giải nén file `robot2027_app_v1.2_pro.zip` và chép đè toàn bộ vào thư mục gốc kho lưu trữ GitHub của bạn (`khotrithucso/robot2027_app_v1.1`).
2. Commit & Push lên nhánh `main` $\rightarrow$ vào tab **Actions** $\rightarrow$ tải artifact **Robot2027-V1.2-Pro-APK** cài đặt lên thiết bị.
