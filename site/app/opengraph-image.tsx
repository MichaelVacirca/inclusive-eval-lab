import { ImageResponse } from "next/og";

export const alt = "InclusiveCode — LGBTQIA+ Safety Tools for LLM Engineers";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
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
          background: "#09090b",
          fontFamily: "system-ui, sans-serif",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Rainbow stripe at top */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: "6px",
            background: "linear-gradient(90deg, #FF6B9D, #FF9B71, #FECF6A, #63E6BE, #74B9FF, #A29BFE, #DDA0DD)",
          }}
        />

        {/* Subtle rainbow glow behind text */}
        <div
          style={{
            position: "absolute",
            width: "600px",
            height: "600px",
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(116,185,255,0.08) 0%, transparent 70%)",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
          }}
        />

        {/* Logo / Brand */}
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            marginBottom: "24px",
          }}
        >
          <span
            style={{
              fontSize: "72px",
              fontWeight: 700,
              color: "#fafafa",
              letterSpacing: "-2px",
            }}
          >
            Inclusive
          </span>
          <span
            style={{
              fontSize: "72px",
              fontWeight: 700,
              letterSpacing: "-2px",
              background: "linear-gradient(90deg, #FF6B9D, #FF9B71, #FECF6A, #63E6BE, #74B9FF, #A29BFE)",
              backgroundClip: "text",
              color: "transparent",
            }}
          >
            Code
          </span>
        </div>

        {/* Tagline */}
        <div
          style={{
            fontSize: "28px",
            color: "#a1a1aa",
            marginBottom: "40px",
            textAlign: "center",
            maxWidth: "800px",
          }}
        >
          LGBTQIA+ Safety Tools for LLM Engineers
        </div>

        {/* Stats row */}
        <div
          style={{
            display: "flex",
            gap: "48px",
            alignItems: "center",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
            <span style={{ fontSize: "40px", fontWeight: 700, color: "#FF6B9D" }}>200</span>
            <span style={{ fontSize: "16px", color: "#71717a" }}>scenarios</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
            <span style={{ fontSize: "40px", fontWeight: 700, color: "#FECF6A" }}>43</span>
            <span style={{ fontSize: "16px", color: "#71717a" }}>anti-patterns</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
            <span style={{ fontSize: "40px", fontWeight: 700, color: "#63E6BE" }}>5</span>
            <span style={{ fontSize: "16px", color: "#71717a" }}>domains</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
            <span style={{ fontSize: "40px", fontWeight: 700, color: "#74B9FF" }}>15</span>
            <span style={{ fontSize: "16px", color: "#71717a" }}>attack templates</span>
          </div>
        </div>

        {/* Rainbow stripe at bottom */}
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            height: "6px",
            background: "linear-gradient(90deg, #FF6B9D, #FF9B71, #FECF6A, #63E6BE, #74B9FF, #A29BFE, #DDA0DD)",
          }}
        />

        {/* URL */}
        <div
          style={{
            position: "absolute",
            bottom: "24px",
            fontSize: "18px",
            color: "#52525b",
            fontFamily: "monospace",
          }}
        >
          inclusive-ai.vercel.app
        </div>
      </div>
    ),
    { ...size }
  );
}
