type ShareCardRenderData = {
  displayName: string;
  homesToday: number;
  rank: number | null;
  participantCount: number;
  dayInChallenge: number;
  totalDays: number;
};

type AccountabilityCardRenderData = {
  headerLabel: string;
  doorsThisWeek: number;
  conversationsThisWeek: number;
  appointmentsThisWeek: number;
  nextWeekGoal: number;
  hashtags: string;
};

const sharedRoot = {
  width: "100%",
  height: "100%",
  display: "flex",
  flexDirection: "column" as const,
  justifyContent: "space-between" as const,
  background: "#0F0F0F",
  color: "#FFFFFF",
  padding: "72px 68px",
  fontFamily: "system-ui, sans-serif",
};

function statBlock(label: string, value: string, accent = "#FFFFFF") {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div
        style={{
          fontSize: 26,
          letterSpacing: 2,
          textTransform: "uppercase",
          color: "rgba(255,255,255,0.58)",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 62,
          fontWeight: 700,
          color: accent,
        }}
      >
        {value}
      </div>
    </div>
  );
}

export function renderShareCard(data: ShareCardRenderData) {
  const rankLabel =
    data.rank != null ? `Rank #${data.rank} of ${data.participantCount}` : `${data.participantCount} participants`;

  return (
    <div style={sharedRoot}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          borderBottom: "1px solid rgba(255,255,255,0.12)",
          paddingBottom: 28,
        }}
      >
        <div
          style={{
            fontSize: 50,
            fontWeight: 800,
            letterSpacing: 2,
          }}
        >WolfGrid</div>
        <div
          style={{
            fontSize: 24,
            color: "rgba(255,255,255,0.72)",
          }}
        >
          First 30 Days Challenge
        </div>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 30,
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 16,
          }}
        >
          <div
            style={{
              fontSize: 28,
              color: "rgba(255,255,255,0.62)",
            }}
          >
            {data.displayName}
          </div>
          <div
            style={{
              fontSize: 168,
              lineHeight: 1,
              fontWeight: 800,
              letterSpacing: -6,
            }}
          >
            {data.homesToday}
          </div>
          <div
            style={{
              fontSize: 48,
              color: "rgba(255,255,255,0.88)",
            }}
          >
            {data.homesToday === 1 ? "door today" : "doors today"}
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr",
            gap: 28,
            paddingTop: 18,
          }}
        >
          {statBlock("Current standing", rankLabel, "#B9FF66")}
          {statBlock("Challenge progress", `Day ${data.dayInChallenge} of ${data.totalDays}`, "#75D7FF")}
        </div>
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
          fontSize: 24,
          color: "rgba(255,255,255,0.42)",
        }}
      >
        <div>Keep knocking. Keep climbing.</div>
        <div>wolfgrid.app</div>
      </div>
    </div>
  );
}

export function renderAccountabilityCard(data: AccountabilityCardRenderData) {
  return (
    <div style={sharedRoot}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          <div
            style={{
              fontSize: 30,
              color: "rgba(255,255,255,0.62)",
              textTransform: "uppercase",
              letterSpacing: 1.5,
            }}
          >
            Accountability story
          </div>
          <div
            style={{
              fontSize: 64,
              fontWeight: 800,
              lineHeight: 1.1,
            }}
          >
            {data.headerLabel}
          </div>
        </div>
        <div
          style={{
            fontSize: 24,
            color: "rgba(255,255,255,0.48)",
          }}
        >WolfGrid</div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr",
          gap: 30,
        }}
      >
        {statBlock("Doors this week", String(data.doorsThisWeek), "#B9FF66")}
        {statBlock("Conversations", String(data.conversationsThisWeek), "#75D7FF")}
        {statBlock("Appointments set", String(data.appointmentsThisWeek), "#FFB86B")}
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 24,
          padding: "28px 32px",
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 28,
          background: "rgba(255,255,255,0.04)",
        }}
      >
        <div
          style={{
            fontSize: 28,
            color: "rgba(255,255,255,0.62)",
            textTransform: "uppercase",
            letterSpacing: 1.5,
          }}
        >
          Next week goal
        </div>
        <div
          style={{
            fontSize: 72,
            fontWeight: 800,
          }}
        >
          {data.nextWeekGoal} doors
        </div>
        <div
          style={{
            fontSize: 28,
            color: "rgba(255,255,255,0.74)",
            lineHeight: 1.4,
          }}
        >
          {data.hashtags}
        </div>
      </div>
    </div>
  );
}
