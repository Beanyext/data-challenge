import { Component, type ReactNode } from 'react';
import { App } from './app';
import { translate as t } from './i18n';

export class ApplicationRoot extends Component<Record<string, never>,{failed:boolean}> {
  state={failed:false};
  static getDerivedStateFromError(){return {failed:true};}
  render():ReactNode {
    if(this.state.failed)return <main className="startup-error"><h1>{t('Не удалось открыть рабочее пространство')}</h1><p>{t('Обновите страницу. Если ошибка повторяется, проверьте формат ответа сервера.')}</p><button className="btn btn-primary" onClick={()=>location.reload()}>{t('Обновить страницу')}</button></main>;
    return <App/>;
  }
}
