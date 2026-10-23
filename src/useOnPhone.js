import { useEffect, useState } from 'react';

// A visitor on a phone (most arrive from one) can't start CopyCam there: it
// starts on the computer. Pointer and width together, so a small laptop window
// doesn't count.
export function useOnPhone() {
  const check = () =>
    typeof window !== 'undefined' && Boolean(window.matchMedia?.('(pointer: coarse)').matches) && window.innerWidth < 700;
  const [onPhone, setOnPhone] = useState(check);
  useEffect(() => {
    const onResize = () => setOnPhone(check());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return onPhone;
}
