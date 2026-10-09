import { useCallback, useEffect, useState } from "react";
import { EMPTY_FILTERS, type Filters } from "../data/filters";
import { parseHash, type Route, toHash } from "./url";

function read() {
  const { route, filters } = parseHash(window.location.hash);
  return { route, filters: { ...EMPTY_FILTERS, ...filters } };
}

export function useHashState() {
  const [state, setState] = useState(read);
  useEffect(() => {
    const onChange = () => setState(read());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  const navigate = useCallback((route: Route, filters: Partial<Filters> = {}) => {
    window.location.hash = toHash(route, filters);
    window.scrollTo(0, 0);
  }, []);
  const setFilters = useCallback((filters: Filters) => {
    setState((s) => {
      window.history.replaceState(null, "", toHash(s.route, filters));
      return { ...s, filters };
    });
  }, []);
  return { ...state, navigate, setFilters };
}
