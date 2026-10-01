import { ImageResponse } from "next/og";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "josefine — she remembers you";

/** The share card — the same dusk field as /about. */
export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#171324",
          position: "relative",
        }}
      >
        <div
          style={{
            position: "absolute",
            width: 900,
            height: 900,
            borderRadius: 9999,
            top: -450,
            left: -200,
            background: "radial-gradient(circle, #f2a5b8 0%, transparent 60%)",
            opacity: 0.6,
          }}
        />
        <div
          style={{
            position: "absolute",
            width: 900,
            height: 900,
            borderRadius: 9999,
            bottom: -400,
            right: -250,
            background: "radial-gradient(circle, #8b7fc4 0%, transparent 60%)",
            opacity: 0.55,
          }}
        />
        <div
          style={{
            fontSize: 160,
            color: "white",
            fontFamily: "Georgia, serif",
            letterSpacing: "-0.03em",
          }}
        >
          josefine
        </div>
        <div style={{ fontSize: 34, color: "rgba(255,255,255,0.6)", marginTop: 24 }}>
          she remembers you
        </div>
      </div>
    ),
    size
  );
}
