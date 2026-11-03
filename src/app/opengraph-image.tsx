import { ImageResponse } from "next/og";

export const alt = "Цифровая учебная платформа Хекслет Колледжа";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "64px 72px",
          background: "linear-gradient(135deg, #fbfaf8 0%, #f5eff9 100%)",
          color: "#24202a",
          fontFamily: "Arial, sans-serif",
        }}
      >
        <div style={{ width: "72%", display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div
              style={{
                width: 52,
                height: 52,
                borderRadius: 16,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "#6c3f8f",
                color: "#fff",
                fontSize: 28,
                fontWeight: 800,
              }}
            >
              H
            </div>
            <div style={{ fontSize: 28, fontWeight: 700 }}>Хекслет Колледж</div>
          </div>
          <div style={{ marginTop: 76, display: "flex", flexDirection: "column" }}>
            <div
              style={{
                color: "#6c3f8f",
                fontSize: 18,
                letterSpacing: 3,
                fontWeight: 700,
              }}
            >
              ЦИФРОВАЯ СРЕДА КОЛЛЕДЖА
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                marginTop: 20,
                fontSize: 58,
                lineHeight: 1.12,
                letterSpacing: -2,
                fontWeight: 700,
              }}
            >
              Учиться. Создавать.
              <br />
              Расти дальше.
            </div>
            <div style={{ marginTop: 24, fontSize: 23, color: "#6a6470" }}>
              Курсы, задания и расписание в одном месте
            </div>
          </div>
        </div>
        <div
          style={{
            width: 218,
            height: 218,
            borderRadius: 109,
            border: "2px solid #d8c7e5",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              width: 154,
              height: 154,
              borderRadius: 40,
              transform: "rotate(-8deg)",
              background: "#6c3f8f",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
              fontSize: 76,
              fontWeight: 700,
            }}
          >
            H
          </div>
        </div>
      </div>
    ),
    size,
  );
}
