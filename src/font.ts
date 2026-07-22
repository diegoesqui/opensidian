import interWoff2 from '@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?url';

// Inter incrustada (subconjunto latino, eje de peso variable, sin cursiva —
// el navegador sintetiza la cursiva) para que la app se vea igual en
// cualquier sistema, sin depender de qué fuentes tenga instaladas.
const style = document.createElement('style');
style.textContent = `
@font-face {
  font-family: 'Inter Variable';
  font-style: normal;
  font-display: swap;
  font-weight: 100 900;
  src: url(${interWoff2}) format('woff2-variations'), url(${interWoff2}) format('woff2');
}
`;
document.head.appendChild(style);
