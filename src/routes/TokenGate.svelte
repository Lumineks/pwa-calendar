<script lang="ts">
  import { setToken } from '../state/auth.ts';

  let inputValue = $state('');
  let showError = $state(false);

  function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    const trimmed = inputValue.trim();
    if (!trimmed) {
      showError = true;
      return;
    }
    showError = false;
    setToken(trimmed);
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
      class="border border-gray-300 rounded-lg px-4 py-2 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
      autocomplete="off"
      autocorrect="off"
      autocapitalize="none"
    />
    <p aria-live="polite" class="text-red-600 text-sm min-h-[1.25rem]">
      {#if showError}Неверный код{/if}
    </p>
    <button
      type="submit"
      class="bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-medium py-2 rounded-lg transition-colors"
    >
      Сохранить
    </button>
  </form>
</div>
