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

def get_addon_config() -> dict:
    if not mw or not mw.addonManager:
        return {}

    config = mw.addonManager.getConfig(__name__)
    return config if isinstance(config, dict) else {}

def write_addon_config(config: dict) -> None:
    if mw and mw.addonManager:
        mw.addonManager.writeConfig(__name__, config)

def save_preferences_data(preferences: Any) -> dict:
    if not isinstance(preferences, dict):
        return get_addon_config()

    config = get_addon_config()
    last_note_type = preferences.get("lastNoteType")
    last_deck_name = preferences.get("lastDeckName")

    if isinstance(last_note_type, dict):
        note_type_config = {}
        note_type_id = last_note_type.get("id")
        note_type_name = last_note_type.get("name")

        if note_type_id is not None:
            note_type_config["id"] = note_type_id
        if isinstance(note_type_name, str):
            note_type_config["name"] = note_type_name

        if note_type_config:
            config["lastNoteType"] = note_type_config

    if isinstance(last_deck_name, str) and last_deck_name.strip():
        config["lastDeckName"] = last_deck_name.strip()

    write_addon_config(config)
    return config

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

def parse_tags(tags: Any) -> List[str]:
    if isinstance(tags, list):
        raw_tags = tags
    elif isinstance(tags, str):
        raw_tags = tags.replace(",", " ").split()
    else:
        raw_tags = []

    parsed_tags = []
    seen_tags = set()
    for tag in raw_tags:
        if not isinstance(tag, str):
            continue
        clean_tag = tag.strip()
        if clean_tag and clean_tag not in seen_tags:
            parsed_tags.append(clean_tag)
            seen_tags.add(clean_tag)
    return parsed_tags

def apply_tags_to_note(note: Any, tags: List[str]) -> None:
    for tag in tags:
        if hasattr(note, "add_tag"):
            note.add_tag(tag)
        elif hasattr(note, "tags"):
            note.tags.append(tag)

def normalize_deck_name(deck_name: Any) -> str:
    if not isinstance(deck_name, str):
        return "Bulk Card Creator"

    parts = [part.strip() for part in deck_name.replace("\\", "/").split("/") if part.strip()]
    if not parts:
        return "Bulk Card Creator"

    return "::".join(parts)

def create_cards(card_data_json: str) -> str:
    try:
        card_data = json.loads(card_data_json)
        noteType=card_data["noteType"]
        cards=card_data["cards"]
        tags = parse_tags(card_data.get("tags"))
        deck_name = normalize_deck_name(card_data.get("deckName"))
        save_preferences_data({
            "lastNoteType": {
                "id": noteType.get("id"),
                "name": noteType.get("name"),
            },
            "lastDeckName": card_data.get("deckName"),
        })
        is_valid, errors = validate_card_data(cards)

        if not is_valid:
            showInfo("start 3")
            return json.dumps({"success": False, "errors": errors})
        
        if not mw or not mw.col:

            showInfo("Please open a collection first")
            return json.dumps({"success": False, "errors": ["Collection not initialized"]})

        deck_id = mw.col.decks.id(deck_name)
      
        model = mw.col.models.by_name(str(noteType["name"]))
        if not model:
            showInfo("start5")
            model = create_new_model(str(noteType["name"]),cards[0])
            if not model:
                return json.dumps({"success": False, "errors": ["Failed to create model"]})
        
        model_fields = [field["name"] for field in model["flds"]]
        created_count = 0
        failed_cards = []

        for index, card in enumerate(cards):
            try:
                note = mw.col.new_note(model)
                for key, value in card.items():
                    if key in model_fields:
                        note[key] = "" if value is None else str(value)
                apply_tags_to_note(note, tags)
                if deck_id:
                    mw.col.add_note(note, deck_id)
                created_count += 1
            except Exception as card_error:
                failed_cards.append({
                    "index": index + 1,
                    "error": str(card_error),
                })
        
        mw.reset()
        message = f"Created {created_count} of {len(cards)} cards in {deck_name}"
        if tags:
            message += f" with {len(tags)} tag{'s' if len(tags) != 1 else ''}"
        showInfo(message)
        return json.dumps({
            "success": created_count > 0 and not failed_cards,
            "partialSuccess": created_count > 0 and bool(failed_cards),
            "message": message,
            "createdCount": created_count,
            "requestedCount": len(cards),
            "failedCount": len(failed_cards),
            "failedCards": failed_cards,
            "deckName": deck_name,
            "tags": tags,
        })
    except Exception as e:
        showInfo(f"Error: {str(e)}")
        return json.dumps({"success": False, "errors": [str(e)]})


class Bridge(QObject):
    @pyqtSlot(str)
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
    @pyqtSlot()
    def get_tags(self,result=None) -> str:
        if mw and mw.col:
            return json.dumps(sorted(mw.col.tags.all()))
        return json.dumps([])
    @pyqtSlot()
    def get_preferences(self,result=None) -> str:
        return json.dumps(get_addon_config())
    @pyqtSlot(str)
    def save_preferences(self, preferences_json: str) -> str:
        try:
            preferences = json.loads(preferences_json)
            return json.dumps(save_preferences_data(preferences))
        except Exception as e:
            return json.dumps({"error": str(e)})
    @pyqtSlot(str)
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
