// Third-party modules, pinned to exact versions and loaded straight from the jsDelivr CDN.
// No build step: Netlify serves these files as they are.
export { h, render } from 'https://cdn.jsdelivr.net/npm/preact@10.24.3/+esm';
export { useState, useEffect, useCallback, useMemo, useRef } from 'https://cdn.jsdelivr.net/npm/preact@10.24.3/hooks/+esm';
export { default as htm } from 'https://cdn.jsdelivr.net/npm/htm@3.1.1/+esm';
export { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
