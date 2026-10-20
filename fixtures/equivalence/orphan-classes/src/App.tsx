/* Regresión: el mapper de ramas (`cond ? 'a' : 'b'`) debe dar por usadas las dos clases,
 * no la de la condición. ternarioError/ternarioOk no pueden salir como huérfanas. */
function claseEstado(estado: string) {
  return estado === 'error' ? 'ternarioError' : 'ternarioOk';
}

export function App({ estado }: { estado: string }) {
  return (
    <div className="usada">
      <span className={claseEstado(estado)} />
    </div>
  );
}
