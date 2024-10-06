import json
import os
from typing import Any, Tuple, List,  Optional, cast,  Callable
from aqt import mw
from aqt.qt import QDialog, QVBoxLayout, QWidget, pyqtSlot, QObject, pyqtSlot, QAction, qconnect,QApplication
from aqt.utils import showInfo
from aqt.webview import AnkiWebView
from aqt import gui_hooks
from anki.models import NotetypeDict


if mw and mw.addonManager:
    addon_package = mw.addonManager.addonFromModule(__name__)
    mw.addonManager.setWebExports(__name__, r"web/.*(css|js)")

def create_new_model(name: str,card:dict) -> Optional[NotetypeDict]:

    if mw and mw.col:
        
        model = mw.col.models.new(name)
        mw.col.models.addField(model, mw.col.models.new_field("Front"))
        answerTemlGenfromCardItems=""
        for key, value in card.items():
            #note[key] = value
            mw.col.models.addField(model, mw.col.models.new_field(key))
            answerTemlGenfromCardItems+=f"{{{{ {key} }}}}"
        template = mw.col.models.new_template("Card 1")
       
        template['qfmt'] = "{{Front}}"
        template['afmt'] = answerTemlGenfromCardItems
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
        if not isinstance(card, dict):
            return False, ["Each card must be a dictionary"]
    return True, []

def create_cards(card_data_json: str) -> str:
    try:
        card_data = json.loads(card_data_json)
        noteType=card_data["noteType"]
        cards=card_data["cards"]
        is_valid, errors = validate_card_data(cards)

        if not is_valid:
            showInfo("start 3")
            return json.dumps({"success": False, "errors": errors})
        
        if not mw or not mw.col:

            showInfo("Please open a collection first")
            return json.dumps({"success": False, "errors": ["Collection not initialized"]})


        deck_name = "Bulk Card Creator"
        deck_id = mw.col.decks.id(deck_name)
      
        model = mw.col.models.by_name(str(noteType["name"]))
        if not model:
            showInfo("start5")
            model = create_new_model(str(noteType["name"]),cards[0])
            if not model:
                return json.dumps({"success": False, "errors": ["Failed to create model"]})
        
        for card in cards:
            note = mw.col.new_note(model)
            for key, value in card.items():
                note[key] = value
                # cast the deck id to int
            if deck_id:
                mw.col.add_note(note, deck_id)
        
        mw.reset()
        showInfo(f"success: {True}, message: Created {len(cards)} cards")
        return json.dumps({"success": True, "message": f"Created {len(cards)} cards"})
    except Exception as e:
        showInfo(f"Error: {str(e)}")
        return json.dumps({"success": False, "errors": [str(e)]})


class Bridge(QObject):
    @pyqtSlot(str, str)
    def create_cards(self, card_data: str) -> str:
        # Implement your card creation logic here
        return create_cards(card_data)
    @pyqtSlot()
    def get_note(self,result=None) -> str:
        
        note_types = []
        if mw and mw.col:
            for model in mw.col.models.all():
                note_type = {
                    "id": model['id'],
                    "name": model['name'],
                    "fields": [field['name'] for field in model['flds']]
                }
                note_types.append(note_type)
            return json.dumps(note_types)
        else:
            return json.dumps({"error": "Collection not initialized"})
    @pyqtSlot(str, bool)
    def copy_to_clipboard(self, text: str) -> bool:
        try:
            clipfn=QApplication.clipboard()
            # copy the text in JSOn format
            if clipfn:
                clipfn.setText(text)
            return True
        except Exception as e:
            print(f"Error copying to clipboard: {e}")
            return False
    

class AnkiCardCreatorWebView(AnkiWebView):
    def __init__(self, parent: Optional[QWidget] = None) -> None:
        super().__init__(parent, title="Anki Card Creator")
        self._bridge = Bridge()
        self._setup_bridge()
        self._load_ui()

    def _setup_bridge(self) -> None:
        self.set_bridge_command(self._on_bridge_message, self._bridge)
        
        self.eval("window.bridgeReady = true;")
        self.eval("if (window.onBridgeReady) window.onBridgeReady();")

    def _return_to_js(self, callback_name: str, data: Any):
        # Ensure the data is JSON-serializable
        json_data = json.dumps(data)
        js_code = f"""
        if (window.pyProcCallback && window.pyProcCallback['{callback_name}']) {{
            window.pyProcCallback['{callback_name}']({json_data});
        }}
        """
        self.eval(js_code)

    def _load_ui(self) -> None:
        addon_package = __name__.split(".")[0]
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
            <script  defer src="/_addons/{addon_package}/web/dist/assets/test.js"></script>
            <script defer src="/_addons/{addon_package}/web/dist/test2.js"></script>
            <script   defer src="/_addons/{addon_package}/web/dist/worker-json.js"></script>
         <script>
                console.log('HTML loaded');
                document.addEventListener('DOMContentLoaded', (event) => {{
                window.bridgeReady = true;
                "if (window.onBridgeReady) window.onBridgeReady();"
                    console.log('DOM fully loaded and parsed');
                }});
            </script>
        </body>
        </html>
        """
        self.stdHtml(html_content)

    def _on_bridge_message(self, message: str) -> Any:
            # cmd fmt #GCFJ:cmd:cmdData(if none null is passed):callbackName
            if message.startswith('GCFJ'):
                splits=message.split(':', 3)
                command_name =  splits[1]
                callback_name = splits[2]
                command_data = splits[3]
                if command_data == "null":
                    command_data = None
                    result = getattr(self._bridge, command_name)(None)
                    
                else:
                    result = getattr(self._bridge, command_name)(command_data)
                self._return_to_js(callback_name, result)
                return result
            return None

# Function to show the dialog
def show_dialog() -> None:
    dialog = QDialog(mw)
    dialog.setWindowTitle("Bulk Card Creator")
    layout = QVBoxLayout()
    
    web_view = AnkiCardCreatorWebView(dialog)
    layout.addWidget(web_view)
    
    dialog.setLayout(layout)
    dialog.setMinimumSize(800, 600)
    dialog.exec()

action = QAction("Bulk Card Creator", mw)
qconnect(action.triggered, show_dialog)

if mw and mw.form:
    mw.form.menuTools.addAction(action)