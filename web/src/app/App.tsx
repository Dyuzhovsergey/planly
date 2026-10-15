import { useSession } from '../features/session/session-context'

export function App() {
  const { state, retry } = useSession()

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl items-center px-6 py-12">
      <section className="w-full rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-widest text-indigo-600">
          Planly
        </p>
        <h1 className="mt-2 text-3xl font-semibold text-slate-950">
          Основа приложения готова
        </h1>

        {state.status === 'loading' && (
          <p className="mt-6 text-slate-600" role="status">
            Восстанавливаем сессию…
          </p>
        )}

        {state.status === 'authenticated' && (
          <div className="mt-6" aria-live="polite">
            <p className="text-slate-700">Вы вошли как</p>
            <p className="mt-1 font-medium text-slate-950">{state.user.email}</p>
            <p className="mt-4 text-sm text-slate-600">
              Часовая зона: {state.user.timeZone}
            </p>
          </div>
        )}

        {state.status === 'anonymous' && (
          <p className="mt-6 text-slate-600">
            Сессия не найдена. Экран входа появится в следующем инкременте.
          </p>
        )}

        {state.status === 'error' && (
          <div className="mt-6" role="alert">
            <p className="text-red-700">Не удалось связаться с Planly API.</p>
            <button
              className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 font-medium text-white hover:bg-indigo-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
              type="button"
              onClick={retry}
            >
              Повторить
            </button>
          </div>
        )}
      </section>
    </main>
  )
}
