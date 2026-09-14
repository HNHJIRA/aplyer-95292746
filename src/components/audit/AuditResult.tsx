import {
  fixList,
  overallTakeList,
  redFlagTitle,
  strengthPoints,
  whyList,
  type Audit,
} from "./types";

const NAVY = "#0a2540";
const GREEN_DARK = "#16a34a";
const RED = "#E5373A";
const TEXT = "#1a2a3a";
const MUTED = "#5a6b7c";

const label: React.CSSProperties = {
  fontFamily: "'DM Mono', monospace",
  fontSize: 13,
  textTransform: "uppercase",
  letterSpacing: 1.2,
  fontWeight: 500,
};

const sectionHeading: React.CSSProperties = {
  color: NAVY,
  fontSize: 28,
  lineHeight: 1.25,
  margin: "40px 0 18px",
  fontWeight: 900,
  letterSpacing: -0.3,
};

function Bullets({
  items,
  color = TEXT,
  testId,
}: {
  items: string[];
  color?: string;
  testId?: string;
}) {
  if (!items.length) return null;
  return (
    <ul
      data-testid={testId}
      style={{
        margin: "8px 0 0",
        paddingLeft: 22,
        listStyleType: "disc",
        listStylePosition: "outside",
        color,
        fontSize: 17,
        lineHeight: 1.65,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      {items.map((it, i) => (
        <li key={i}>{it}</li>
      ))}
    </ul>
  );
}

export default function AuditResult({ audit }: { audit: Audit }) {
  // Order is preserved exactly as the backend returns it. Never sort here.
  const redFlags = audit.redFlags ?? [];
  const strengths = strengthPoints(audit);
  const overall = overallTakeList(audit);

  return (
    <div style={{ minWidth: 0, fontFamily: "'Lato', Arial, sans-serif" }}>
      <div style={{ ...label, fontSize: 13, color: GREEN_DARK, marginBottom: 10 }}>Your Audit</div>

      {(overall.points.length > 0 || overall.text) && (
        <section data-testid="overall-take">
          <h2 style={{ ...sectionHeading, marginTop: 0 }}>Overall Take</h2>
          {overall.points.length > 0 ? (
            <Bullets items={overall.points} testId="overall-take-points" />
          ) : (
            <p style={{ fontSize: 18, lineHeight: 1.65, color: TEXT, margin: 0 }}>{overall.text}</p>
          )}
        </section>
      )}

      {redFlags.length > 0 && (
        <section data-testid="red-flags">
          <h2 style={sectionHeading}>Red Flags</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            {redFlags.map((rf, i) => {
              const why = whyList(rf);
              const fix = fixList(rf);
              return (
                <article
                  key={i}
                  data-testid="red-flag-card"
                  style={{
                    background: "#fff5f6",
                    border: "1px solid #f3cbcd",
                    borderLeft: `5px solid ${RED}`,
                    borderRadius: 12,
                    padding: "22px 24px",
                  }}
                >
                  <div style={{ ...label, fontSize: 12, color: RED, marginBottom: 8 }}>
                    Red Flag {i + 1}
                  </div>
                  <h3
                    data-testid="red-flag-title"
                    style={{
                      fontWeight: 900,
                      color: NAVY,
                      fontSize: 20,
                      lineHeight: 1.35,
                      margin: "0 0 4px",
                    }}
                  >
                    {redFlagTitle(rf)}
                  </h3>
                  {rf.employer && (
                    <div style={{ ...label, fontSize: 12, color: MUTED, marginBottom: 12 }}>
                      {rf.employer}
                    </div>
                  )}

                  {why.length > 0 && (
                    <div style={{ marginTop: 14 }}>
                      <div style={{ ...label, fontSize: 12, color: MUTED }}>Why this matters</div>
                      <Bullets items={why} testId="why-points" />
                    </div>
                  )}

                  {fix.length > 0 && (
                    <div style={{ marginTop: 16 }}>
                      <div style={{ ...label, fontSize: 12, color: GREEN_DARK }}>Fix</div>
                      <Bullets items={fix} testId="fix-points" />
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      )}

      {strengths.length > 0 && (
        <section data-testid="strengths">
          <h2 style={sectionHeading}>Strengths</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {strengths.map((s, i) => (
              <article
                key={i}
                data-testid="strength-card"
                style={{
                  background: "#f1fdf5",
                  border: "1px solid #bfe8cd",
                  borderLeft: `5px solid ${GREEN_DARK}`,
                  borderRadius: 12,
                  padding: "20px 24px",
                }}
              >
                <div style={{ ...label, fontSize: 12, color: GREEN_DARK, marginBottom: 8 }}>
                  Strength {i + 1}
                </div>
                <p style={{ margin: 0, fontSize: 17, lineHeight: 1.65, color: TEXT }}>{s}</p>
              </article>
            ))}
          </div>
        </section>
      )}

      {audit.topPriority && (
        <section data-testid="top-priority">
          <h2 style={sectionHeading}>Top Priority</h2>
          <div
            style={{
              background: "#fffaf0",
              border: "1px solid #f0dcb4",
              borderLeft: "5px solid #d99a1e",
              borderRadius: 12,
              padding: "20px 24px",
              fontSize: 17,
              lineHeight: 1.65,
              color: TEXT,
            }}
          >
            {audit.topPriority}
          </div>
        </section>
      )}

      {audit.closing && (
        <p
          data-testid="closing"
          style={{
            marginTop: 36,
            padding: "22px 24px",
            background: "#f4f6f9",
            borderRadius: 12,
            color: TEXT,
            fontSize: 17,
            lineHeight: 1.65,
          }}
        >
          {audit.closing}
        </p>
      )}
    </div>
  );
}
