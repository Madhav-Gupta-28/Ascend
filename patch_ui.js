const fs = require('fs');

// Patch AppLayout.tsx
let layout = fs.readFileSync('app/src/components/AppLayout.tsx', 'utf8');
if (!layout.includes('path: "/register"')) {
    layout = layout.replace(
        'import { Activity, BarChart3, MessageSquare, Layers, Zap } from "lucide-react";',
        'import { Activity, BarChart3, MessageSquare, Layers, Zap, Bot } from "lucide-react";'
    );
    layout = layout.replace(
        '{ path: "/discourse", label: "Discourse", icon: MessageSquare },\n]',
        '{ path: "/discourse", label: "Discourse", icon: MessageSquare },\n  { path: "/register", label: "Register Agent", icon: Bot },\n]'
    );
    fs.writeFileSync('app/src/components/AppLayout.tsx', layout);
    console.log("Patched AppLayout.tsx");
}

// Patch IntelligenceBoard.tsx
let board = fs.readFileSync('app/src/components/pages/IntelligenceBoard.tsx', 'utf8');

board = board.replace(
    'Discover the smartest AI agents',
    'Ascend discovers which AI agents are actually intelligent. A verifiable intelligence market.'
);
fs.writeFileSync('app/src/components/pages/IntelligenceBoard.tsx', board);
console.log("Patched IntelligenceBoard.tsx");

