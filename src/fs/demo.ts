import type { Vault } from './vault';

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const daysAgo = (n: number) => iso(new Date(Date.now() - n * 86_400_000));

/** Rellena un vault vacío con contenido de ejemplo (solo modo ?demo). */
export async function seedDemoVault(v: Vault): Promise<void> {
  if (await v.exists('Bienvenida.md')) return;

  await v.writeFile(
    'Bienvenida.md',
    [
      '# Bienvenida a Opensidian',
      '',
      'Tus notas viven como archivos **markdown** en tu equipo.',
      '',
      '## Qué puedes hacer',
      '',
      '- Escribir con *cursiva*, **negrita** y ~~tachado~~',
      '- Crear listas de tareas:',
      '- [ ] Probar el diario',
      '- [x] Abrir la app sin instalar nada',
      '- Usar `código` y bloques:',
      '',
      '```',
      'npm run build',
      '```',
      '',
      '> Las notas se guardan solas mientras escribes.',
      ''
    ].join('\n')
  );

  await v.writeFile(
    'Proyectos/Opensidian.md',
    [
      '# Opensidian',
      '',
      '- [x] Definir requisitos',
      '- [ ] Probar en el portátil del trabajo',
      '- [ ] Mover notas viejas de Notepad',
      ''
    ].join('\n')
  );

  await v.writeFile(
    'Trabajo/Reuniones.md',
    ['# Reuniones', '', '## Pendientes', '', '- [ ] Enviar acta al equipo', ''].join('\n')
  );

  await v.writeFile(
    `journal/${daysAgo(1)}.md`,
    ['- [x] Preparar la demo', '- [ ] Revisar el correo', '', 'Idea: apuntar aquí lo del proyecto.', ''].join('\n')
  );
  await v.writeFile(
    `journal/${daysAgo(2)}.md`,
    ['Llamada con el equipo: **retrasamos la entrega** una semana.', ''].join('\n')
  );
  await v.writeFile(`journal/${daysAgo(4)}.md`, ['- [x] Cerrar presupuesto', ''].join('\n'));
}
