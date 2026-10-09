import { useCallback, useEffect, useRef, useState } from "react";
import { EMPTY_FILTERS, type Filters } from "../data/filters";
import { parseHash, type Route, toHash } from "./url";

function read() {
  const { route, filters } = parseHash(window.location.hash);
  return { route, filters: { ...EMPTY_FILTERS, ...filters } };
}

export function useHashState() {
  const [state, setState] = useState(read);
  const routeKey = useRef(JSON.stringify(state.route));
  useEffect(() => {
    const onChange = () => {
      const next = read();
      const key = JSON.stringify(next.route);
      // Scroll to the top on a page change, not when only the filters changed.
      if (key !== routeKey.current) window.scrollTo(0, 0);
      routeKey.current = key;
      setState(next);
    };
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  const navigate = useCallback((route: Route, filters: Partial<Filters> = {}) => {
    window.location.hash = toHash(route, filters);
  }, []);
  const setFilters = useCallback((filters: Filters) => {
    setState((s) => {
      window.history.replaceState(null, "", toHash(s.route, filters));
      return { ...s, filters };
    });
  }, []);
  return { ...state, navigate, setFilters };
}
