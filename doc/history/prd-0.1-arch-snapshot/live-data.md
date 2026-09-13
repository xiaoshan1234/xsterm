workspace-xxx:
    window-001:
        pane-001:xterm
        pane-002:xterm
    window-002:
        pane-001:xterm
        pane-002:xterm
        pane-003:xterm

ws : workspace
wd : window

app :
    ws-pool

ws :
    ws-name
    ws-id
    ws-src-config
    ws-type
    wd-pool
    link-pool

wd :
    wd-name
    wd-id
    wd-src-config
    wd-type
    panel-tree

pane :
    pane-id
    link-type
    link-id
    contex
    pane-config
