import { createRoot } from 'react-dom/client';
import { ApplicationRoot } from './root';

const container=document.getElementById('root');
if(!container)throw new Error('Missing React root element.');
createRoot(container).render(<ApplicationRoot/>);
