import json
import os
from typing import Any, Tuple, List,  Optional, cast,  Callable
from aqt import mw
from aqt.qt import QDialog, QVBoxLayout, QWidget, pyqtSlot, QObject, pyqtSlot, QAction, qconnect
from aqt.utils import showInfo
from aqt.webview import AnkiWebView
from aqt import gui_hooks
from anki.models import NotetypeDict


if mw and mw.addonManager:
    addon_package = mw.addonManager.addonFromModule(__name__)
    mw.addonManager.setWebExports(__name__, r"web/.*(css|js)")

def create_new_model(name: str) -> Optional[NotetypeDict]:
    if mw and mw.col:
        model = mw.col.models.new(name)
        mw.col.models.addField(model, mw.col.models.new_field("Front"))
        mw.col.models.addField(model, mw.col.models.new_field("Back"))
        template = mw.col.models.new_template("Card 1")
        template['qfmt'] = "{{Front}}"
        template['afmt'] = "{{Front}}<hr id=answer>{{Back}}"
        model['css'] = ".card { font-family: arial; font-size: 20px; text-align: center; color: black; background-color: white; }"
        mw.col.models.addTemplate(model, template)
        mw.col.models.save(model)
        return model
    else:
        showInfo("Please open a collection first")
        raise RuntimeError("Collection (mw.col) is not initialized.")

def validate_card_data(card_data: Any) -> Tuple[bool, List[str]]:
    if not isinstance(card_data, list):
        return False, ["Card data must be a list"]
    for card in card_data:
        if not isinstance(card, dict) or 'front' not in card or 'back' not in card:
            return False, ["Each card must be a dictionary with at least 'front' and 'back' keys"]
    return True, []

def create_cards(card_data_json: str) -> str:
    try:
        card_data = json.loads(card_data_json)
        is_valid, errors = validate_card_data(card_data)

        if not is_valid:
            showInfo("start 3")
            return json.dumps({"success": False, "errors": errors})
        
        if not mw or not mw.col:

            showInfo("Please open a collection first")
            return json.dumps({"success": False, "errors": ["Collection not initialized"]})


        deck_name = "Bulk Card Creator"
        deck_id= (mw.col.decks.id(deck_name)) 
        showInfo("start90")
        # the deck id is an int and never none
        
      
        model = mw.col.models.by_name("Basic")
        showInfo("start19")
        if not model:
            model = create_new_model("Basic")
            if not model:
                return json.dumps({"success": False, "errors": ["Failed to create model"]})
        showInfo("start9")
        for card in card_data:
            showInfo("start10")
            note = mw.col.new_note(model)
            note['Front'] = card['front']
            note['Back'] = card['back']
            for key, value in card.items():
                showInfo("start11")
                if key not in ['front', 'back'] and key in note:
                    note[key] = value
                    showInfo("start20")
            showInfo("start23")
            mw.col.add_note(note, deck_id)
        
        showInfo("start7")
        mw.reset() 

        return json.dumps({"success": True, "message": f"Created {str(len(card_data))} cards"})
    except Exception as e:
        showInfo(f"Error: {str(e)}")
        return json.dumps({"success": False, "errors": [str(e)]})

class Bridge(QObject):
    @pyqtSlot(str)
    def create_cards(self, card_data: str) -> str:
        showInfo(f"create_cards 9 called with: {card_data}")
        return create_cards(card_data)

class AnkiCardCreatorWebView(AnkiWebView):
    def __init__(self, parent: Optional[QWidget] = None) -> None:
        super().__init__(parent, title="Anki Card Creator")
        self._bridge = Bridge()
        self.set_bridge_command(self._on_bridge_message, self._bridge)

    def _on_bridge_message(self, message: str) -> Any:
        if message.startswith('create_cards:'):
            card_data = message.split(':', 1)[1]
            result = self._bridge.create_cards(card_data)
            self.eval(f"console.log('Python result:', {result})")
            return result
        return None

   
def show_dialog() -> None:
    dialog = QDialog(mw)
    dialog.setWindowTitle("Bulk Card Creator")
    layout = QVBoxLayout()
    
    web_view = AnkiCardCreatorWebView(dialog)
    html_content = f"""
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Anki Card Creator</title>
        <link rel="stylesheet" href="/_addons/{addon_package}/web/dist/assets/index.css">
    </head>
    <body>
        <div id="root"></div>
        <script type="module" src="/_addons/{addon_package}/web/dist/assets/index.js"></script>
        <script>
            console.log('HTML loaded');
            document.addEventListener('DOMContentLoaded', (event) => {{
                console.log('DOM fully loaded and parsed');
            }});
        </script>
    </body>
    </html>
    """
    
    web_view.stdHtml(html_content)
    layout.addWidget(web_view)
    
    dialog.setLayout(layout)
    dialog.setMinimumSize(800, 600)
    dialog.exec()

gui_hooks.webview_did_receive_js_message.append(cast(Callable, AnkiCardCreatorWebView._on_bridge_message))

action = QAction("Bulk Card Creator", mw)
qconnect(action.triggered, show_dialog)

if mw and mw.form:
    mw.form.menuTools.addAction(action)