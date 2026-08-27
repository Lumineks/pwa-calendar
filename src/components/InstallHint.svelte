<script lang="ts">
  interface Props {
    onContinue: () => void;
  }
  let { onContinue }: Props = $props();
</script>

<div class="install-hint">
  <h1>Установите приложение</h1>
  <ol>
    <li><span class="num">1</span> Нажмите <strong>Поделиться</strong> <span class="share-icon" aria-hidden="true">&#x2BAD;</span> внизу экрана</li>
    <li><span class="num">2</span> Выберите <strong>«На экран „Домой“»</strong></li>
    <li><span class="num">3</span> Нажмите <strong>«Добавить»</strong> и откройте приложение с домашнего экрана</li>
  </ol>
  <p class="note">Код доступа нужно будет ввести уже внутри установленного приложения.</p>
  <button
    type="button"
    class="continue"
    onpointerup={onContinue}
    onkeydown={(e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onContinue();
      }
    }}
  >Продолжить в браузере</button>
</div>

<style>
  .install-hint {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 18px;
    padding: 32px 24px;
    background: #fbf6e9;
    color: #2c2412;
    font-family: -apple-system, system-ui, 'Segoe UI', Roboto, sans-serif;
  }
  h1 { font-size: 22px; font-weight: 700; margin: 0; }
  ol { display: flex; flex-direction: column; gap: 12px; margin: 0; padding: 0; list-style: none; font-size: 16px; }
  .num {
    display: inline-flex; align-items: center; justify-content: center;
    width: 24px; height: 24px; margin-right: 8px;
    border-radius: 50%; background: #2c2412; color: #fbf6e9;
    font-size: 13px; font-weight: 700;
  }
  .note { font-size: 14px; color: #5a4a26; margin: 0; }
  .continue {
    align-self: flex-start;
    padding: 10px 16px;
    border: 1px solid rgba(70, 60, 35, 0.25);
    border-radius: 10px;
    background: transparent;
    color: #2c2412;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
  }
</style>
