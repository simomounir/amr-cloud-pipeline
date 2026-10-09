import { useEffect, useState } from "react";
import { Footer } from "./components/Footer";
import { Header } from "./components/Header";
import { type DashboardDb, openDashboardDb } from "./data/db";
import { Explore } from "./pages/Explore";
import { Home } from "./pages/Home";
import { Method } from "./pages/Method";
import { StudyPage } from "./pages/StudyPage";
import { useHashState } from "./state/useHashState";
import { useTheme } from "./theme";

const DATA_URL = new URL("data/", document.baseURI).href;

export function App() {
  const [db, setDb] = useState<DashboardDb>();
  const [fatal, setFatal] = useState<string>();
  const { route, filters, setFilters } = useHashState();
  const { theme, toggle } = useTheme();
  useEffect(() => {
    openDashboardDb(DATA_URL).then(setDb, (e: Error) => setFatal(e.message));
  }, []);

  return (
    <div className="app">
      {db && <Header studies={db.studies} infos={db.infos} route={route} theme={theme} onToggleTheme={toggle} />}
      {fatal ? (
        <p className="fatal" role="alert">
          {fatal}
        </p>
      ) : !db ? (
        <div className="skeleton" aria-busy="true">
          Loading dataset…
        </div>
      ) : (
        <>
          {route.page === "home" && <Home studies={db.studies} infos={db.infos} />}
          {route.page === "study" && <StudyPage study={route.study} studies={db.studies} infos={db.infos} />}
          {route.page === "explore" && <Explore conn={db.conn} filters={filters} setFilters={setFilters} theme={theme} />}
          {route.page === "method" && <Method />}
        </>
      )}
      {db && <Footer studies={db.studies} manifests={db.manifests} counts={db.counts} failed={db.failed} />}
    </div>
  );
}
