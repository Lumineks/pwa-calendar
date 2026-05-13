<script lang="ts">
  import { setToken } from '../state/auth.ts';
  import { health, isApiError, isNetworkError } from '../data/api.ts';

  /**
   * Phase 6: validate the entered token against /health BEFORE storing it.
   * The auth store stays null until the Worker confirms 200 OK.
   *
   *   empty input       → "Неверный код"   (no network call)
   *   401               → "Неверный код"
   *   200               → setToken() and let App.svelte route us into /week/
   *   network/CORS error→ "Нет соединения" (stay on gate, button re-enabled)
   *   any other ApiError→ surface a generic error (very unlikely with the
   *                       deployed worker's response shape, but defensive)
   *
   * The button is disabled while a /health request is in flight so the user
   * can't fire two parallel validations.
   */

  type GateState = 'idle' | 'validating';
  type ErrorKind = 'none' | 'invalid' | 'offline' | 'unknown';

  let inputValue = $state('');
  let gateState = $state<GateState>('idle');
  let errorKind = $state<ErrorKind>('none');

  const ERROR_LABEL: Record<ErrorKind, string> = {
    none: '',
    invalid: 'Неверный код',
    offline: 'Нет соединения',
    unknown: 'Ошибка сети',
  };

  async function handleSubmit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (gateState === 'validating') return;

    const trimmed = inputValue.trim();
    if (!trimmed) {
      errorKind = 'invalid';
      return;
    }

    errorKind = 'none';
    gateState = 'validating';

    try {
      await health(trimmed);
      // 200 → commit. App.svelte's $token subscription will re-render into
      // the routed app and (via the new $effect in App.svelte) start sync.
      setToken(trimmed);
    } catch (e) {
      if (isApiError(e) && e.status === 401) {
        errorKind = 'invalid';
      } else if (isNetworkError(e)) {
        errorKind = 'offline';
      } else {
        errorKind = 'unknown';
      }
    } finally {
      gateState = 'idle';
    }
  }
</script>

<div class="min-h-screen flex items-center justify-center bg-white">
  <form onsubmit={handleSubmit} class="flex flex-col gap-4 w-full max-w-sm px-6">
    <h1 class="text-2xl font-semibold text-center text-gray-800">Введите код доступа</h1>
    <input
      type="text"
      placeholder="Код"
      bind:value={inputValue}
      style="font-size: 16px"
      class="border border-gray-300 rounded-lg px-4 py-2 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:opacity-60"
      autocomplete="off"
      autocorrect="off"
      autocapitalize="none"
      disabled={gateState === 'validating'}
    />
    <p aria-live="polite" class="text-red-600 text-sm min-h-[1.25rem]">
      {ERROR_LABEL[errorKind]}
    </p>
    <button
      type="submit"
      disabled={gateState === 'validating'}
      class="bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-medium py-2 rounded-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
    >
      {gateState === 'validating' ? 'Проверка…' : 'Сохранить'}
    </button>
  </form>
</div>
