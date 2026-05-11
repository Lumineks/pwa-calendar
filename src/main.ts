import { mount } from 'svelte'
import './styles/app.css'
import './styles/paper.css'
import App from './App.svelte'

const app = mount(App, {
  target: document.getElementById('app')!,
})

export default app
