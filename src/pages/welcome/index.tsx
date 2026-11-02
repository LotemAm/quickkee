import '../../shared/testSeam';
import { createRoot } from 'react-dom/client';
import { Welcome } from './Welcome';
import '../../assets/styles/tailwind.css';
import './index.css';

const root = document.querySelector('#__root');
if (!root) throw new Error("Can't find Welcome root element");
createRoot(root).render(<Welcome />);
