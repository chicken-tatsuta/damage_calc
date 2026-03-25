// src/App.tsx
import React, { Suspense, useState } from "react";
import {
  Box,
  CssBaseline,
  ThemeProvider,
  Typography,
  createTheme,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
} from "@mui/material";
import BoltIcon from "@mui/icons-material/Bolt";
import GroupsIcon from "@mui/icons-material/Groups";
import SpeedIcon from "@mui/icons-material/Speed";
import SportsMmaIcon from "@mui/icons-material/SportsMma"; // 追加

const DamageCalculatorPage = React.lazy(
  () => import("./pages/DamageCalculatorPage")
);
const PartyTypePage = React.lazy(
  () => import("./pages/PartyTypePage")
);
const SpeedLinePage = React.lazy(
  () => import("./pages/SpeedLinePage")
);
const MatchupSimulatorPage = React.lazy(
  () => import("./pages/MatchupSimulatorPage")
); // 追加

const theme = createTheme({
  palette: {
    mode: "light",
    primary: { main: "#e53935" },
    secondary: { main: "#5e35b1" },
    background: {
      default: "#f6f7fb",
      paper: "#ffffff",
    },
  },
  shape: { borderRadius: 18 },
  typography: {
    fontFamily:
      '"Inter","Noto Sans JP",system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif',
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          background: "#f6f7fb",
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: ({ theme }) => ({
          border: `1px solid ${theme.palette.divider}`,
          boxShadow: "0 12px 36px rgba(0,0,0,0.06)",
          borderRadius: 18,
        }),
      },
    },
    MuiCardHeader: {
      styleOverrides: {
        title: { fontWeight: 900 },
        subheader: { fontWeight: 700 },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: { fontWeight: 800 },
      },
    },
    MuiSlider: {
      styleOverrides: {
        thumb: {
          boxShadow: "0 0 0 8px rgba(229,57,53,0.12)",
        },
      },
    },
  },
});

type ToolId = "damage" | "party" | "speed" | "matchup"; // matchup追加

const App: React.FC = () => {
  const [currentTool, setCurrentTool] = useState<ToolId>("damage");

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />

      <Box
        sx={{
          display: "flex",
          minHeight: "100vh",
          bgcolor: "background.default",
        }}
      >
        {/* ===== 左サイドバー ===== */}
        <Box
          sx={{
            width: 240,
            flexShrink: 0,
            borderRight: "1px solid",
            borderColor: "divider",
            bgcolor: "background.paper",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <Box
            sx={{
              p: 2.5,
              borderBottom: "1px solid",
              borderColor: "divider",
            }}
          >
            <Typography variant="h6" fontWeight={900}>
              NIKIPoké Tools
            </Typography>
            <Typography variant="caption" color="text.secondary">
              ツール
            </Typography>
          </Box>

          <Box sx={{ flex: 1 }}>
            <List dense sx={{ py: 0 }}>
              <ListItemButton
                selected={currentTool === "damage"}
                onClick={() => setCurrentTool("damage")}
              >
                <ListItemIcon sx={{ minWidth: 32 }}>
                  <BoltIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText primary="ダメージ計算" />
              </ListItemButton>

              <ListItemButton
                selected={currentTool === "party"}
                onClick={() => setCurrentTool("party")}
              >
                <ListItemIcon sx={{ minWidth: 32 }}>
                  <GroupsIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText primary="パーティ補完" />
              </ListItemButton>

              <ListItemButton
                selected={currentTool === "speed"}
                onClick={() => setCurrentTool("speed")}
              >
                <ListItemIcon sx={{ minWidth: 32 }}>
                  <SpeedIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText primary="Sライン早見" />
              </ListItemButton>

              <ListItemButton
                selected={currentTool === "matchup"}
                onClick={() => setCurrentTool("matchup")}
              >
                <ListItemIcon sx={{ minWidth: 32 }}>
                  <SportsMmaIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText primary="対面勝率シミュ" />
              </ListItemButton>
            </List>
          </Box>
        </Box>

        {/* ===== 右側：中身エリア ===== */}
        <Box sx={{ flex: 1 }}>
          <Suspense
            fallback={
              <Box sx={{ p: 3 }}>
                <Typography color="text.secondary">読み込み中…</Typography>
              </Box>
            }
          >
            {currentTool === "damage" && <DamageCalculatorPage />}
            {currentTool === "party" && <PartyTypePage />}
            {currentTool === "speed" && <SpeedLinePage />}
            {currentTool === "matchup" && <MatchupSimulatorPage />}
          </Suspense>
        </Box>
      </Box>
    </ThemeProvider>
  );
};

export default App;